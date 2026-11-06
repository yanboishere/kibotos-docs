---
title: 通过原生 API
description: 不经过 kibo，用 curl 以 mTLS 调用 ctrl：确认身份、创建 Workspace、申请会话凭证、经 /v1/files 上传下载文件、删除 Workspace，并给出 Go 客户端的装配方式。
---

# 通过原生 API

本页用 `curl` 与 `jq` 直接调用 Kibotos 的原生 API，走完一次最小流程：确认身份可用、创建 Workspace、上传并下载一个文件、删除 Workspace。读者是要把 Kibotos 接进自己程序的开发者；每一步的完整语义见[原生 API](/integrate/native-api/overview)各页。

## 前提条件 {#prerequisites}

- 从平台运营方获得两样东西：ctrl 的地址（本页以 `https://ctrl.example.com:18092` 为例），以及一把 Operator 注册密钥（enrollment key）文件。注册密钥只能使用一次，有效期由签发时决定，默认 1 小时。
- 本机装有 `kibo`，用来完成注册（enrollment），安装方法见[安装与连接](/integrate/kibo/setup)。不想安装 `kibo` 时，可以按[身份与认证](/integrate/native-api/authentication)中「自行注册」一节用自己的程序完成注册，再从第 2 步继续。
- `curl` 7.76 或更新版本，支持 HTTP/2 与 TLS 1.3；`jq`；`openssl`（只用来生成随机的幂等键）。

::: warning 注意
注册得到的 Operator 身份（identity）对所在部署拥有完整的管理权限：能读取、修改和删除部署里的全部 Workspace、Volume 等资源，也能调用 Operator API。目前没有更细的角色划分。像保管其他高权限凭证一样保管它的私钥，每个程序使用自己的一份身份。
:::

## 步骤 {#steps}

### 1. 注册一份专用身份 {#enroll}

把身份放进一个专用目录，不要复用你自己的 `kibo` 正在使用的目录：

```bash
export KIBO_CONTEXT_DIR="$HOME/.config/kibotos/quickstart"
umask 077
kibo context enroll --endpoint https://ctrl.example.com:18092 --key-file operator-enrollment.key
rm operator-enrollment.key
```

- `kibo context enroll` 先用注册密钥里携带的 ctrl 服务端 CA 验证 ctrl，再换取正式身份，连同 ctrl 地址保存到 `KIBO_CONTEXT_DIR`。目录不存在时自动创建，权限为 `0700`；目录里已有身份时命令拒绝覆盖。
- `--endpoint` 的主机名必须与平台运营方给出的地址逐字一致。
- 注册成功后删除密钥文件。

### 2. 准备调用环境 {#shell}

下面的变量与函数供后续步骤在同一个 shell 里使用。证书文件名带有序列号，续期后会变，所以每次都从 `manifest.json` 读取：

```bash
ctx="$KIBO_CONTEXT_DIR"
endpoint=$(jq -r .endpoint "$ctx/context.json")
cert="$ctx/$(jq -r .certificate_file "$ctx/manifest.json")"
key="$ctx/$(jq -r .private_key_file "$ctx/manifest.json")"
server_ca="$ctx/server-ca.pem"

ctrl_call() {
  curl --silent --show-error --fail-with-body --http2 --tlsv1.3 \
    --cert "$cert" --key "$key" --cacert "$server_ca" \
    -H 'Content-Type: application/json' --data "$2" \
    "$endpoint/$1"
}

new_id() { printf 'quickstart-%s\n' "$(openssl rand -hex 8)"; }
```

- `ctrl_call` 的第一个参数是 `包名.服务名/方法名`，第二个参数是 JSON 请求体。每个调用都是 `POST`；没有参数的方法也要发送 `{}`。
- `--cacert` 让 `curl` 只信任 `server-ca.pem`，不使用系统根证书。`curl` 默认校验主机名，也不跟随重定向，符合控制面的要求，见[身份与认证](/integrate/native-api/authentication)。
- `--fail-with-body` 让 `curl` 在出错时以非零状态退出，同时打印错误响应体。
- `new_id` 生成幂等键（command ID）。每个写请求带一个，发送前先存进变量，结果未知时用它原样重发。

::: tip JSON 的写法
- 请求里的字段名可以写 proto 原名（`command_id`）或 JSON 名（`commandId`），本页用原名。响应一律用 JSON 名，即小驼峰形式，例如 `workspaceId`。
- 枚举写完整名称，例如 `WORKSPACE_STATE_AVAILABLE`；时长写成 `"3600s"`；64 位整数在响应里是字符串。
- 值为零或为空的字段不出现在响应里。
- 服务端忽略请求里不认识的字段。字段名拼错不会报错，只会被当作没有给出，构造请求时逐一核对。
:::

### 3. 确认身份与能力 {#server-info}

调用 `GetServerInfo`，能拿到响应就说明证书、地址与信任锚都正确：

```bash
ctrl_call kibotos.ctrl.v1.ServerInfoService/GetServerInfo '{}' | jq .
```

响应里的 `capabilities` 是服务端提供的能力名（capability）列表，`sourceRevision` 只用于展示。需要某项能力的操作先检查它，例如：

```bash
ctrl_call kibotos.ctrl.v1.ServerInfoService/GetServerInfo '{}' \
  | jq -e '.capabilities | index("workspace.create") != null'
```

规则见[能力协商](/integrate/native-api/conventions#capabilities)。

### 4. 选择 Template {#template}

列出可以用来创建 Workspace 的 Template：

```bash
ctrl_call kibotos.ctrl.v1.TemplateService/ListTemplates '{}' \
  | jq -r '.templates[] | [.templateId, .displayName] | @tsv'
```

从列表里选一个，记在变量里：

```bash
template_id=kibotos-coding
```

部署里有哪些 Template 由平台运营方决定。把 `kibotos-coding` 换成上一条命令列出的某个 ID；内置 Template 的说明见[内置 Template](/templates/builtin)。

### 5. 创建 Workspace {#create}

先生成并保存幂等键，再组装请求：

```bash
create_id=$(new_id)
create_request=$(jq -n --arg command_id "$create_id" --arg template_id "$template_id" '{
  metadata: {command_id: $command_id},
  spec: {
    template: {template_id: $template_id},
    resources: {cpu_millis: 1000, memory_bytes: 1073741824},
    volume: {mode: "WORKSPACE_VOLUME_MODE_NEW", mount_path: "/data"},
    network_policy: {mode: "NETWORK_POLICY_MODE_DENY_ALL"}
  },
  expiration: {timeout: "3600s", action: "WORKSPACE_EXPIRATION_ACTION_DELETE"},
  labels: {app: "quickstart"}
}')
workspace_id=$(ctrl_call kibotos.ctrl.v1.WorkspaceService/CreateWorkspace "$create_request" | jq -r .workspace.workspaceId)
echo "$workspace_id"
```

| 字段 | 本例的取值与含义 |
|---|---|
| `metadata.command_id` | 幂等键。相同的键加相同的请求重发，拿到的是同一个 Workspace |
| `spec.template.template_id` | 使用的 Template。没有写 `revision`，服务端选用它当前的默认 revision 并固定在 Workspace 上 |
| `spec.resources.cpu_millis` | 毫核，`1000` 即 1 个 vCPU。必填，大于 0 |
| `spec.resources.memory_bytes` | 内存字节数，这里是 1 GiB。必填，必须是 MiB 的整数倍且不小于 128 MiB |
| `spec.volume` | 新建一个 Volume 挂在 `/data`，删除 Workspace 时一起删除。只有这个路径承诺在停止与启动之间保留数据 |
| `spec.network_policy` | `DENY_ALL`：不允许出站，也是缺省值 |
| `expiration` | 1 小时后自动删除，防止忘记清理 |
| `labels` | 调用方自己的标签，可用于筛选 |

`CreateWorkspace` 在 ctrl 接受命令后立即返回，此时 Workspace 处于 `WORKSPACE_STATE_CREATING`，创建在服务端继续进行。没有收到响应时，用同一个 `$create_request` 原样重发，不要换新的幂等键：服务端只会创建一个 Workspace。全部字段见 [Workspace](/integrate/native-api/workspaces#create)。

### 6. 等待 Workspace 可用 {#wait}

轮询 `GetWorkspace`，直到状态不再变化：

```bash
get_request=$(jq -n --arg id "$workspace_id" '{workspace_id: $id}')
while :; do
  state=$(ctrl_call kibotos.ctrl.v1.WorkspaceService/GetWorkspace "$get_request" | jq -r .workspace.state)
  echo "$state"
  case "$state" in
    WORKSPACE_STATE_AVAILABLE|WORKSPACE_STATE_FAILED|WORKSPACE_STATE_UNKNOWN|WORKSPACE_STATE_DELETED) break ;;
  esac
  sleep 2
done
```

- 某个 node 第一次使用这个 Template 时要先接收它的文件，可能需要几分钟。这期间响应里的 `workspace.delivery` 给出 `transferredBytes` 与 `totalBytes`，用来区分「还在传」与「卡住了」。
- 结果不是 `WORKSPACE_STATE_AVAILABLE` 时，查询这条创建命令的结果：

```bash
ctrl_call kibotos.ctrl.v1.WorkspaceService/GetWorkspaceCommand \
  "$(jq -n --arg id "$workspace_id" --arg command_id "$create_id" '{workspace_id: $id, command_id: $command_id}')" \
  | jq '.command | {status, errorCode, error}'
```

`error.reason` 与 `error.message` 说明失败原因，含义见[错误码](/reference/errors#native)。

### 7. 申请会话凭证 {#session}

文件、进程等操作直接访问运行 Workspace 的 node。先向 ctrl 申请一张短期会话凭证（data-plane session credential），这里申请读写文件的权限，有效 10 分钟：

```bash
session_command_id=$(new_id)
session=$(ctrl_call kibotos.ctrl.v1.DataPlaneSessionService/CreateDataPlaneSession "$(jq -n \
  --arg command_id "$session_command_id" --arg id "$workspace_id" '{
    metadata: {command_id: $command_id},
    workspace_id: $id,
    requested_scopes: ["DATA_PLANE_SCOPE_FILE_READ", "DATA_PLANE_SCOPE_FILE_WRITE"],
    requested_ttl: "600s"
  }')")
data_endpoint=$(jq -r .session.endpoint <<<"$session")
credential=$(jq -r .credential <<<"$session")
jq '.session | {sessionId, endpoint, scopes, expiresAt}' <<<"$session"
```

- `session.endpoint` 是 node 数据面的地址，下一步用它作为 base URL。
- `credential` 是 bearer 凭证，拿到它就能以这些权限访问这个 Workspace。只把它放在内存变量与 `Authorization` 头里，日志和 URL 里都不能出现它。
- 有效期缺省 5 分钟，最长 15 分钟。规则见[申请会话凭证](/integrate/native-api/data-plane#session)。

### 8. 上传与下载文件 {#files}

定义一个访问数据面的函数。凭证经标准输入交给 `curl`，不会出现在进程列表里：

```bash
data_call() {
  printf 'Authorization: Bearer %s\n' "$credential" \
    | curl --silent --show-error --fail-with-body --http2 --cacert "$server_ca" -H @- "$@"
}
```

上传一个文件到 `/data/hello.txt`，权限为 `0644`：

```bash
printf 'hello from the native API\n' > hello.txt
data_call --upload-file hello.txt "$data_endpoint/v1/files?path=/data/hello.txt&mode=0644" | jq .
```

响应形如 `{"path": "/data/hello.txt", "size_bytes": 26, "sha256": "…"}`。用 `sha256sum hello.txt`（macOS 上是 `shasum -a 256 hello.txt`）核对摘要。

把它下载回来并比较：

```bash
data_call -o downloaded.txt "$data_endpoint/v1/files?path=/data/hello.txt"
cmp hello.txt downloaded.txt && echo identical
```

- `PUT` 在文件写入存储之后才返回。覆盖已有文件时先写临时文件再替换，失败时原文件保持不变。
- `path` 必须是 guest 中的绝对路径；路径里有特殊字符时按 URL 规则编码。
- 数据面信任系统根证书加上 `server-ca.pem`，而 `curl` 的 `--cacert` 只信任给出的文件。数据面证书由 Kibotos 签发时这样就够了；平台运营方在 node 前面放了公网 TLS 反向代理时，去掉 `--cacert` 改用系统信任库。不确定时向平台运营方确认。

参数、上限与错误见[文件传输 /v1/files](/integrate/native-api/data-plane#files-http)。

### 9. 删除 Workspace {#delete}

删除请求必须带上当前的到期设置版本 `expiration.revision`，即使没有设置到期时间也一样：

```bash
expiration_revision=$(ctrl_call kibotos.ctrl.v1.WorkspaceService/GetWorkspace "$get_request" | jq -r .workspace.expiration.revision)
delete_request=$(jq -n --arg command_id "$(new_id)" --arg id "$workspace_id" --arg revision "$expiration_revision" '{
  metadata: {command_id: $command_id},
  workspace_id: $id,
  expected_expiration_revision: $revision
}')
ctrl_call kibotos.ctrl.v1.WorkspaceService/DeleteWorkspace "$delete_request" | jq -r .workspace.state
```

- `DeleteWorkspace` 最多等 1 分钟。返回 `unavailable` 时删除仍在进行，用同一个 `$delete_request` 重发，直到返回 `WORKSPACE_STATE_DELETED`。
- 本例的 Volume 是随 Workspace 新建的，删除 Workspace 时一起删除，`/data` 里的文件随之消失。

## Go 装配示例 {#go}

下面的程序读取同一个 context 目录，按控制面的 TLS 要求装配 HTTP 客户端，然后调用 `GetServerInfo` 与 `GetWorkspace`，并演示怎样取出错误详情：

```go
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"

	"connectrpc.com/connect"

	ctrlv1 "github.com/memohai/kibotos/gen/go/ctrl/v1"
	"github.com/memohai/kibotos/gen/go/ctrl/v1/ctrlv1connect"
)

type contextFile struct {
	Endpoint string `json:"endpoint"`
}

type manifestFile struct {
	CertificateFile string `json:"certificate_file"`
	PrivateKeyFile  string `json:"private_key_file"`
	ServerCAFile    string `json:"server_ca_file"`
}

func readJSON(path string, value any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, value)
}

// newCtrlClient 按控制面的要求装配 mTLS：TLS 1.3，只信任 server-ca.pem，
// 主机名与地址精确匹配，不跟随重定向。
func newCtrlClient(dir string) (*http.Client, string, error) {
	var document contextFile
	if err := readJSON(filepath.Join(dir, "context.json"), &document); err != nil {
		return nil, "", err
	}
	var manifest manifestFile
	if err := readJSON(filepath.Join(dir, "manifest.json"), &manifest); err != nil {
		return nil, "", err
	}
	certificate, err := tls.LoadX509KeyPair(
		filepath.Join(dir, manifest.CertificateFile),
		filepath.Join(dir, manifest.PrivateKeyFile),
	)
	if err != nil {
		return nil, "", err
	}
	caPEM, err := os.ReadFile(filepath.Join(dir, manifest.ServerCAFile))
	if err != nil {
		return nil, "", err
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(caPEM) {
		return nil, "", errors.New("server-ca.pem holds no certificate")
	}
	endpoint, err := url.Parse(document.Endpoint)
	if err != nil {
		return nil, "", err
	}
	transport := &http.Transport{
		ForceAttemptHTTP2: true,
		TLSClientConfig: &tls.Config{
			MinVersion:   tls.VersionTLS13,
			Certificates: []tls.Certificate{certificate},
			RootCAs:      roots,
			ServerName:   endpoint.Hostname(),
		},
	}
	client := &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	return client, document.Endpoint, nil
}

func main() {
	httpClient, endpoint, err := newCtrlClient(os.Getenv("KIBO_CONTEXT_DIR"))
	if err != nil {
		log.Fatal(err)
	}
	ctx := context.Background()

	info, err := ctrlv1connect.NewServerInfoServiceClient(httpClient, endpoint).
		GetServerInfo(ctx, connect.NewRequest(&ctrlv1.GetServerInfoRequest{}))
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(len(info.Msg.GetCapabilities()), "capabilities")

	workspaces := ctrlv1connect.NewWorkspaceServiceClient(httpClient, endpoint)
	got, err := workspaces.GetWorkspace(ctx, connect.NewRequest(&ctrlv1.GetWorkspaceRequest{
		WorkspaceId: os.Args[1],
	}))
	if err != nil {
		var connectErr *connect.Error
		if errors.As(err, &connectErr) {
			for _, detail := range connectErr.Details() {
				value, valueErr := detail.Value()
				if failure, ok := value.(*ctrlv1.ErrorDetail); valueErr == nil && ok {
					log.Fatalf("%s: %s (retryable=%t)", connectErr.Code(), failure.GetReason(), failure.GetRetryable())
				}
			}
		}
		log.Fatal(err)
	}
	fmt.Println(got.Msg.GetWorkspace().GetState())
}
```

运行时把 Workspace ID 作为参数传入，例如 `go run . ws-01k6...`。

::: warning Go 生成代码不在兼容承诺范围内
示例导入的是 Kibotos 源码仓库 `gen/go/` 下的生成代码。它的 Go 签名、包路径以及依赖的 connect-go 主版本可能在任何版本里改变，承诺只针对线上协议。

- 推荐向平台运营方获取与部署版本一致的 proto 定义，用自己选定的生成器版本生成代码，并换成你自己的包路径。proto 文件里没有 `go_package` 选项，生成 Go 代码时用 buf 的 managed 模式或 `protoc` 的 `M` 映射参数指定。
- 直接导入 `gen/go/` 的，把依赖固定到某个版本，升级时按编译结果调整。
:::

长期运行的程序还要处理身份续期：续期之后新请求要走出示新证书的连接，做法见[身份与认证](/integrate/native-api/authentication)。

## 排查 {#troubleshooting}

| 现象 | 原因 | 处理 |
|---|---|---|
| `curl` 报服务端证书校验失败 | 地址里的主机名与 ctrl 证书不一致，或用错了 `server-ca.pem` | 使用平台运营方给出的原始地址；地址与身份文件来自同一个 context 目录 |
| TLS 握手时客户端证书被拒绝 | 身份已过期，或不属于这个部署 | 向平台运营方申请新的注册密钥，删除旧目录后重新注册 |
| `permission_denied`，消息为 `operator principal is not admitted` | 身份已被撤销，或程序还在用两次续期之前的旧证书 | 确认身份没有被撤销；续期后改用新证书建立连接 |
| `invalid_argument` | 缺少必填字段或取值不合法，例如没有 `metadata.command_id`，或 `memory_bytes` 不是 MiB 的整数倍 | 按错误消息修正请求 |
| `already_exists` | 同一个幂等键配了不同的请求内容 | 结果未知时原样重发原请求；发起新操作时换一个新的幂等键 |
| 响应里没有某个字段 | JSON 响应省略值为零或为空的字段 | 按该字段的零值处理 |
| `/v1/files` 返回 401 | 会话凭证缺失或已过期 | 重新申请会话凭证 |

## 下一步 {#next-steps}

- [概述与协议](/integrate/native-api/overview)：两个入口、协议与服务清单。
- [身份与认证](/integrate/native-api/authentication)：身份文件、自行注册、续期与撤销。
- [调用约定](/integrate/native-api/conventions)：能力协商、幂等键、版本校验与错误格式。
- [Workspace](/integrate/native-api/workspaces)：创建参数、状态、启停与删除。
- [数据面：文件与进程](/integrate/native-api/data-plane)：会话凭证、文件、进程与目录监视。
