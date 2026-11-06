---
title: 身份与认证
description: Operator 身份是什么、有什么权限；用 kibo 的 context 目录或自行注册获得身份；控制面与数据面的 TLS 要求；30 天有效期与续期；为其他程序签发与撤销身份。
---

# 身份与认证

本页说明程序怎样获得并使用访问 Kibotos 原生 API 所需的身份：从注册密钥换取身份、按要求配置 TLS、按时续期，以及为其他程序签发或撤销身份。读者是集成开发者，以及评审凭证与权限的安全人员。

## 概述 {#overview}

调用原生 API 需要一份 Operator 身份（identity）：由 ctrl 签发的客户端证书，加上验证 ctrl 所需的信任锚。程序用它以 mTLS 访问 ctrl。证书里的身份 URI 形如 `spiffe://<信任域>/operator/<Operator ID>`，信任域与 Operator ID 都写在证书里，由签发时决定。

- **权限**：已注册的 Operator 对所在部署拥有完整的管理权限，可以调用 Workspace API 与 Operator API 的全部方法，读取、修改和删除部署中的全部资源。目前没有更细的角色或资源级授权。
- **只信任服务端证书没有任何权限**：没有有效的 Operator 身份，浏览器或其他客户端即使信任了 ctrl 的证书，也调用不了任何方法。
- **来源**：身份通过注册（enrollment）获得。平台运营方签发一把一次性的注册密钥（enrollment key），你用它向 ctrl 换取正式身份。已有身份的 Operator 也可以为自己的其他程序签发密钥，见[签发与撤销](#issue-revoke)。

::: danger
身份的私钥等同于整个部署的管理权限。私钥只留在运行程序的机器上，文件权限设为仅属主可读；不放进镜像、版本库、日志或环境变量。怀疑泄露时立即撤销这份身份。
:::

注册密钥本身也是凭证：它包含一把引导私钥和 ctrl 的服务端 CA。默认有效 1 小时，签发时可以在 1 分钟到 24 小时之间选择，只能成功使用一次。通过安全渠道传递，注册成功后删除。

## 方式一：使用 kibo 的 context 目录 {#kibo-context}

最简单的方式是用 `kibo context enroll` 为程序注册一个专用目录，程序从目录里读取证书。安装 `kibo` 见[安装与连接](/integrate/kibo/setup)。

```bash
export KIBO_CONTEXT_DIR=/srv/agent-runner/kibotos-identity
umask 077
kibo context enroll --endpoint https://ctrl.example.com:18092 --key-file agent-runner.key
rm agent-runner.key
```

- `KIBO_CONTEXT_DIR` 必须是绝对路径。不设置时默认是 `$XDG_CONFIG_HOME/kibo/context`，未设置 `XDG_CONFIG_HOME` 时是 `~/.config/kibo/context`，那是你自己使用 `kibo` 的目录，不要让程序读取它。
- 目录不存在时自动创建，权限 `0700`；已经存在时不能对组或其他用户开放权限。目录里已有身份时注册被拒绝，要重新注册就先停止使用它的程序、删除目录。
- `--endpoint` 必须是 HTTPS，主机名与平台运营方给出的地址逐字一致。需要经正向代理访问时在这条命令上加 `--proxy`，支持 `http://`、`https://` 与 `socks5://`，设置保存在目录里。
- 密钥可以在终端里无回显输入，或用 `--key-stdin`、`--key-fd`、`--key-file` 三者之一提供。`--key-file` 指向的必须是普通文件；文件对组或其他用户开放了权限时，`kibo` 打印警告但仍然读取，建议设为 `0600`。密钥不能通过命令行参数或环境变量传入。

目录里的文件：

| 文件 | 用途 |
|---|---|
| `context.json` | ctrl 地址 `endpoint`，以及可选的代理 `proxy` |
| `manifest.json` | 当前身份的清单：`uri`（身份 URI）、`certificate_file`、`private_key_file`、`ca_file`、`server_ca_file` |
| `identity-<序列号>.pem`、`identity-<序列号>.key` | 客户端证书与私钥，用于 mTLS。私钥文件权限为 `0600` |
| `server-ca.pem` | ctrl 的服务端 CA。访问 ctrl 时只信任它 |
| `control-client-ca.pem` | 签发客户端证书的 CA，用于在本地校验证书链 |

- 证书与私钥的文件名带序列号，续期后改变，旧文件随之删除。每次加载身份时都先读 `manifest.json`，再按其中的文件名读取证书与私钥。
- 一个目录只给一个程序使用，见[一个程序一份身份](#one-identity-per-program)。

## 方式二：自行注册 {#self-enrollment}

程序也可以不经过 `kibo`，直接用注册密钥完成注册。

### 注册密钥的格式 {#enrollment-key-format}

注册密钥是一个以 `kek1.` 开头的字符串，后面是用 `.` 分隔的三段，每段都是不带填充的 base64url 编码，整个字符串不超过 8 KiB：

| 段 | 内容 |
|---|---|
| 第一段 | 引导证书，DER 编码 |
| 第二段 | 引导私钥，PKCS#8 DER 编码 |
| 第三段 | ctrl 的服务端 CA 证书，DER 编码 |

### 步骤 {#enroll-steps}

1. 在本地生成一把新私钥，类型为 ECDSA P-256 或 Ed25519。私钥始终留在客户端。
2. 用这把私钥生成 CSR：DER 编码的 PKCS#10，大小在 8 KiB 以内。CSR 只用来证明你持有私钥：扩展与 DNS、IP、URI、邮箱等名字都必须为空，subject 会被忽略，身份完全由注册密钥对应的授权决定。
3. 用引导证书与引导私钥做 mTLS 连接 ctrl，只信任第三段的服务端 CA，并按[控制面 TLS 配置](#control-plane-tls)的其余要求连接。
4. 调用 `kibotos.enrollment.v1.EnrollmentService/Enroll`，请求只有一个字段 `certificate_request`，即上一步的 CSR。
5. 响应的 `identity` 是一个 `IssuedIdentity`：

| 字段 | 含义 |
|---|---|
| `identity_uri` | 身份 URI，形如 `spiffe://<信任域>/operator/<Operator ID>` |
| `certificate` | 签发的客户端证书，DER 编码 |
| `ca_certificate` | 签发客户端证书的 CA，DER 编码，供保存前校验证书链 |
| `serial` | 证书序列号 |
| `not_before`、`not_after` | 证书有效期 |

6. 校验之后保存证书、私钥、服务端 CA（来自注册密钥第三段）与 `ca_certificate`，此后用正式身份访问 ctrl。

### 规则 {#enroll-rules}

- **引导身份只能调用 `Enroll`，正式身份只能调用 `Renew`。** 这条规则在服务端读取请求体之前就生效。正式身份再调用 `Enroll` 会被拒绝；引导身份调用 Workspace API 或 Operator API 返回 `unauthenticated`。
- **一把密钥只能成功注册一次。** 用同一个 CSR 重发 `Enroll` 会拿回同一张证书，所以在注册成功之前保留第 1 步的私钥与 CSR，没有收到响应时原样重发即可；换一个 CSR 再用这把密钥返回 `already_exists`。
- **密钥的有效期就是引导证书的有效期。** 过期之后 TLS 握手就会失败；已被撤销或已过期的密钥调用 `Enroll` 返回 `failed_precondition`；引导证书与授权不一致时返回 `permission_denied`。这些情况都需要向平台运营方重新申请密钥。

保存之前，建议按 `kibo` 的做法校验：`ca_certificate` 与服务端 CA 属于同一个信任域；证书链能用 `ca_certificate` 验证，用途是客户端认证；证书中的公钥与你的私钥匹配；证书的 URI 与 `identity_uri` 一致，类型是 `operator`；有效期合理。

### Go 示例 {#enroll-go}

下面的程序读取注册密钥，完成注册并把身份写成 PEM 文件。导入的是 Kibotos 源码仓库的 Go 生成代码，它不在兼容承诺范围内，自行生成时换成你自己的包路径：

```go
package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"connectrpc.com/connect"

	enrollmentv1 "github.com/memohai/kibotos/gen/go/enrollment/v1"
	"github.com/memohai/kibotos/gen/go/enrollment/v1/enrollmentv1connect"
)

const (
	endpoint   = "https://ctrl.example.com:18092"
	serverName = "ctrl.example.com"
)

// decodeKey 拆开 kek1 注册密钥：引导证书、引导私钥与 ctrl 服务端 CA。
func decodeKey(text string) (tls.Certificate, *x509.Certificate, error) {
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, "kek1.") {
		return tls.Certificate{}, nil, errors.New("not a kek1 enrollment key")
	}
	parts := strings.Split(strings.TrimPrefix(text, "kek1."), ".")
	if len(parts) != 3 {
		return tls.Certificate{}, nil, errors.New("a kek1 enrollment key has three parts")
	}
	var der [3][]byte
	for i, part := range parts {
		decoded, err := base64.RawURLEncoding.DecodeString(part)
		if err != nil {
			return tls.Certificate{}, nil, err
		}
		der[i] = decoded
	}
	bootstrapKey, err := x509.ParsePKCS8PrivateKey(der[1])
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	serverCA, err := x509.ParseCertificate(der[2])
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	return tls.Certificate{Certificate: [][]byte{der[0]}, PrivateKey: bootstrapKey}, serverCA, nil
}

func writePEM(path, blockType string, der []byte, mode os.FileMode) error {
	return os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: blockType, Bytes: der}), mode)
}

func main() {
	raw, err := os.ReadFile("agent-runner.key")
	if err != nil {
		log.Fatal(err)
	}
	bootstrap, serverCA, err := decodeKey(string(raw))
	if err != nil {
		log.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(serverCA)
	httpClient := &http.Client{
		Transport: &http.Transport{
			ForceAttemptHTTP2: true,
			TLSClientConfig: &tls.Config{
				MinVersion:   tls.VersionTLS13,
				Certificates: []tls.Certificate{bootstrap},
				RootCAs:      roots,
				ServerName:   serverName,
			},
		},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}

	// 私钥在本地生成，只把 CSR 发给 ctrl。
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		log.Fatal(err)
	}
	csr, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{}, key)
	if err != nil {
		log.Fatal(err)
	}
	response, err := enrollmentv1connect.NewEnrollmentServiceClient(httpClient, endpoint).
		Enroll(context.Background(), connect.NewRequest(&enrollmentv1.EnrollRequest{CertificateRequest: csr}))
	if err != nil {
		log.Fatal(err)
	}
	identity := response.Msg.GetIdentity()

	// 保存之前校验证书链、用途与公钥。
	clientCA, err := x509.ParseCertificate(identity.GetCaCertificate())
	if err != nil {
		log.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(identity.GetCertificate())
	if err != nil {
		log.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(clientCA)
	if _, err := leaf.Verify(x509.VerifyOptions{Roots: pool, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}); err != nil {
		log.Fatal(err)
	}
	if !key.PublicKey.Equal(leaf.PublicKey) || len(leaf.URIs) != 1 || leaf.URIs[0].String() != identity.GetIdentityUri() {
		log.Fatal("issued identity does not match the request")
	}

	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		log.Fatal(err)
	}
	for _, file := range []struct {
		path, blockType string
		der             []byte
		mode            os.FileMode
	}{
		{"identity.key", "PRIVATE KEY", keyDER, 0o600},
		{"identity.pem", "CERTIFICATE", identity.GetCertificate(), 0o644},
		{"control-client-ca.pem", "CERTIFICATE", identity.GetCaCertificate(), 0o644},
		{"server-ca.pem", "CERTIFICATE", serverCA.Raw, 0o644},
	} {
		if err := writePEM(file.path, file.blockType, file.der, file.mode); err != nil {
			log.Fatal(err)
		}
	}
	fmt.Println("enrolled as", identity.GetIdentityUri(), "until", identity.GetNotAfter().AsTime())
}
```

## 控制面 TLS 配置 {#control-plane-tls}

访问 ctrl 的客户端按下面的要求配置 TLS，注册、续期与业务调用都一样：

- TLS 1.3 或更高，ALPN 声明 `h2`。
- 只信任 `server-ca.pem`（自行注册时是注册密钥的第三段），不使用系统根证书。
- 服务端证书的 SAN 必须与地址中的主机名精确匹配，不接受通配符。平台运营方给出的主机名或 IP 原样使用，换成别名或另一种写法会导致校验失败。
- 出示 Operator 身份的证书与私钥作为客户端证书。
- 不跟随 HTTP 重定向。
- 需要经正向代理时，用 HTTP CONNECT 或 SOCKS5 建立隧道，TLS 与 mTLS 在隧道内完成，代理不终止 TLS。

ctrl 的服务端证书有效期 30 天，由 ctrl 自动更换，调用方不需要处理；`server-ca.pem` 不会在线轮换。

## 有效期与续期 {#renewal}

- 身份证书有效期 30 天。剩余不到 10 天时应当续期。
- 续期是用当前身份做 mTLS，调用 `kibotos.enrollment.v1.EnrollmentService/Renew`，请求体是一把新私钥的 CSR（字段同样是 `certificate_request`，规则与注册相同）。响应的 `identity` 是同一个身份 URI 的新证书。
- 已经过期的身份无法续期，只能向平台运营方申请新的注册密钥重新注册。
- 使用 context 目录的程序可以让 `kibo` 负责续期：`kibo` 每次访问 ctrl 前，发现剩余不到 10 天就自动续期，也可以定期执行 `kibo context renew`（设置同一个 `KIBO_CONTEXT_DIR`）。续期后 `manifest.json` 指向新文件，程序要重新加载。只让一个使用者负责续期。

长期运行的程序续期之后，新请求要在出示新证书的连接上发出：

- 一条 TLS 连接始终出示握手时的证书，一直有请求的连接也不会因为空闲而关闭。
- ctrl 只接受一个身份的当前证书与上一张证书。继续在续期前建立的连接上发请求，再续期一次之后，这条连接上的请求都会被拒绝，返回 `permission_denied`。
- 做法：续期并校验新证书后，用它构造新的 HTTP 客户端（新的连接池）发送之后的请求；旧客户端上的请求与流结束后，关闭它的空闲连接。

```go
// 续期：用当前身份的客户端 currentClient 调用 Renew，提交新私钥的 CSR。
newKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
if err != nil {
	return err
}
csr, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{}, newKey)
if err != nil {
	return err
}
renewed, err := enrollmentv1connect.NewEnrollmentServiceClient(currentClient, endpoint).
	Renew(ctx, connect.NewRequest(&enrollmentv1.RenewRequest{CertificateRequest: csr}))
if err != nil {
	return err
}
// 按注册时的方法校验 renewed.Msg.GetIdentity() 并保存，然后用新证书构造新的
// http.Client 发送之后的请求，旧客户端用完后调用 CloseIdleConnections。
```

## 一个程序一份身份 {#one-identity-per-program}

ctrl 只接受一个身份的当前证书与上一张证书。几个使用者共用一份身份、各自续期时，每次续期都会让更早的证书失效；使用者超过两个时，总有一个出示的证书被拒绝。

- 每个程序使用自己的身份。同一个程序部署多个实例时，每个实例也各用一份。
- 身份目录只供一个程序使用。其他程序、其他机器各自注册；你自己的 `kibo` 使用的目录只留给你自己。
- 用 Operator ID 区分用途，例如 `agent-runner-01`、`agent-runner-02`，便于审计与单独撤销。

## 签发与撤销身份 {#issue-revoke}

已注册的 Operator 可以用 `kibo` 为自己的其他程序签发注册密钥，也可以撤销它们的身份。

为新程序签发一把有效 1 小时的密钥：

```bash
kibo enrollment create --operator agent-runner-02 --ttl 1h --output agent-runner-02.key
```

- `--operator` 是新身份的 Operator ID：1 到 253 个字符，只能用字母、数字、`.`、`_` 与 `-`。
- `--ttl` 取 1 分钟到 24 小时，默认 1 小时。
- `--output` 必填，文件必须不存在，写入后权限为 `0600`。密钥只写进这个文件，命令输出（包括 `--json`）只有 grant ID、主体、有效期与文件名，ctrl 不保存完整密钥。
- 带 `--command-id` 重复执行同一个签发时，ctrl 返回原来的授权但不再返回密钥，`kibo` 以非零状态退出且不写文件。
- 把密钥文件经安全渠道交给新程序，注册完成后两边都删除。

撤销一份身份：

```bash
kibo enrollment revoke --operator agent-runner-02 --yes
```

- 撤销立即生效且不可逆：这个 Operator 尚未使用的注册密钥全部作废，它的正式身份此后的请求、注册与续期都被拒绝。
- 撤销不影响已有的 Workspace 与正在进行的数据面连接，它们按各自的规则继续。已经签发出去的会话凭证仍在有效期内，怀疑凭证一并泄露时，对相关 Workspace 调用 `RevokeWorkspaceDataPlane`，见 [Workspace](/integrate/native-api/workspaces)。
- 需要让它恢复时，重新签发一把密钥并重新注册。

命令的完整参数见 [kibo 命令参考](/reference/kibo-cli)。

## 数据面 TLS {#data-plane-tls}

数据面（node）使用与控制面不同的 TLS 规则：

| | 控制面（ctrl） | 数据面（node） |
|---|---|---|
| 信任的根证书 | 只信任 `server-ca.pem` | 系统根证书加上 `server-ca.pem` |
| 主机名校验 | SAN 与地址精确匹配 | 按标准规则校验，接受通配符证书 |
| 客户端证书 | Operator 身份，mTLS | 不需要 |
| 认证方式 | 证书 | `Authorization: Bearer` 会话凭证 |
| 重定向 | 不跟随 | 不跟随 |

- 数据面信任系统根证书，是为了让平台运营方可以把 node 放在使用公网证书的 TLS 反向代理后面。
- 只在 TLS 校验成功之后才发送会话凭证。经代理访问时使用与控制面相同的代理设置。
- 会话凭证的申请与使用见[申请会话凭证](/integrate/native-api/data-plane#session)。

## 排查 {#troubleshooting}

| 现象 | 原因 | 处理 |
|---|---|---|
| 客户端报服务端证书校验失败 | 地址中的主机名与 ctrl 证书的 SAN 不一致，或信任了错误的 CA | 使用平台运营方给出的主机名；确认 `server-ca.pem` 与身份来自同一次注册 |
| TLS 握手时客户端证书被拒绝 | 身份已过期，或证书不是这个部署签发的 | 向平台运营方申请新的注册密钥，删除旧目录后重新注册 |
| `permission_denied`，消息为 `operator principal is not admitted` | 身份已被撤销，或出示的证书比上一张更旧 | 确认身份状态；续期后改用新证书建立的连接 |
| `unauthenticated`，消息为 `operator principal is required` | 出示的不是 Operator 正式身份，例如用引导证书调用了业务方法 | 先完成注册，再用正式身份调用 |
| `Enroll` 返回 `already_exists` | 这把密钥已经用另一个 CSR 注册过 | 找回第一次注册得到的身份，或申请新的密钥 |
| `Enroll` 返回 `failed_precondition` | 密钥已过期或已被撤销 | 申请新的密钥 |
| `Enroll` 返回 `permission_denied` | 引导证书与授权不一致，或密钥不是签给 Operator 的 | 核对密钥文件是否完整；申请新的密钥 |

## 相关文档 {#related}

- [概述与协议](/integrate/native-api/overview)：两个入口与协议。
- [申请会话凭证](/integrate/native-api/data-plane#session)：数据面凭证的范围、有效期与续签。
- [身份、凭证与访问控制](/security/credentials)：从安全评审的角度看身份与凭证。
- [安装与连接](/integrate/kibo/setup)：安装 `kibo` 并建立连接。
