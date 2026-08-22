# Windows 飞行员假名化转换工具

该工具读取 `测试.xlsx`、通讯录和 CrewQual 当前 CSV 模板，生成稳定假名化的
`CrewQual-飞行员批量导入-待补.csv`。它不会生成真实姓名与 mock 编号的明文对照表。

> 输出保留原始业务日期，因此属于假名化数据，不是匿名数据。机型、职务、单位代码和人员级别仍为空，人工补齐前不能正式导入 CrewQual。

## 一次性安装

1. 安装 Python 3.11 或更高版本，并确保 Windows 的 `py.exe` 可用。
2. 在命令提示符中运行：

   ```bat
   tools\pilot-mock-windows\setup_windows.bat
   ```

依赖会安装到 `%LOCALAPPDATA%\CrewQual\pilot-mock-venv`，不会在项目目录创建虚拟环境。

## 密钥

首次使用时，在本机 PowerShell 中生成 32 字节随机密钥并放入当前会话的环境变量：

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$env:CREWQUAL_MOCK_HMAC_KEY_HEX = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
```

把该值保存进企业密码管理器，以后转换相同人员时必须设置同一密钥。不要把密钥写入项目文件、
Excel、CSV、命令行参数、日志或 AI 对话。转换脚本只从 `CREWQUAL_MOCK_HMAC_KEY_HEX` 读取密钥。

## 运行

将下面三个文件放在当前命令行目录：

- `测试.xlsx`
- 文件名包含“通讯录”的唯一 `.xlsx`
- `CrewQual-飞行员批量导入模板-当前.csv`

然后运行：

```bat
tools\pilot-mock-windows\run_conversion.bat
```

需要指定文件时：

```bat
tools\pilot-mock-windows\run_conversion.bat ^
  --source "D:\data\测试.xlsx" ^
  --contacts "D:\data\飞行员通讯录.xlsx" ^
  --template "D:\data\CrewQual-飞行员批量导入模板-当前.csv" ^
  --output "D:\data\CrewQual-飞行员批量导入-待补.csv"
```

只有在确认允许覆盖旧结果时添加 `--overwrite`。脚本遇到姓名/手机号歧义、重复人员键、表头变化
或无法完成自检时会停止，不会输出半可信 CSV。错误只报告工作表行号，不打印真实姓名或手机号。
