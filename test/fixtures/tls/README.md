# 测试用 TLS 证书（一次性、可随时重新生成）

`localhost-cert.pem` / `localhost-key.pem` 是**纯测试夹具**：

- 自签、CN=localhost、SAN 只有 `localhost` 与 `127.0.0.1`；
- 只被 `test/relay.test.js` 用来验证「relay 自己终结 TLS」这条路径；
- **不要用于任何真实部署**，也不要拿它当模板。

之所以提交进仓库而不是测试时现生成：CI（ubuntu-latest）不保证装了 `openssl`
或 Python `cryptography`，而 TLS 路径又必须真的被跑一遍——否则「relay 能起 TLS」
就只是没验证过的假设。有效期 10 年，避免证书过期把 CI 拖红。

重新生成（需要 Python + `cryptography`）：

```sh
python - <<'PY'
import datetime, ipaddress
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

out = Path('test/fixtures/tls')
key = ec.generate_private_key(ec.SECP256R1())
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')])
now = datetime.datetime.now(datetime.timezone.utc)
cert = (
    x509.CertificateBuilder()
    .subject_name(name).issuer_name(name)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now - datetime.timedelta(days=1))
    .not_valid_after(now + datetime.timedelta(days=3650))
    .add_extension(x509.SubjectAlternativeName([
        x509.DNSName('localhost'),
        x509.IPAddress(ipaddress.IPv4Address('127.0.0.1')),
    ]), critical=False)
    .sign(key, hashes.SHA256())
)
(out / 'localhost-cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
(out / 'localhost-key.pem').write_bytes(key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.TraditionalOpenSSL,
    encryption_algorithm=serialization.NoEncryption(),
))
PY
```
