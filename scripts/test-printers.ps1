# プリンタ疎通確認 — TCP 9100 で接続できるかを各プリンタについてチェック
$printers = @(
  @{ code='PRN-01'; ip='192.168.1.219' },
  @{ code='PRN-02'; ip='192.168.1.220' },
  @{ code='PRN-03'; ip='192.168.1.221' },
  @{ code='PRN-04'; ip='192.168.1.224' },
  @{ code='PRN-05'; ip='192.168.1.225' }
)
foreach ($p in $printers) {
  $r = Test-NetConnection -ComputerName $p.ip -Port 9100 -InformationLevel Quiet -WarningAction SilentlyContinue
  $status = if ($r) { 'OK   ' } else { 'NG !!' }
  Write-Host "$status $($p.code) ($($p.ip):9100)"
}
