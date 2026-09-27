$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8080

Write-Host "Khushali Jewells ERP local server"
Write-Host "Keep this window open."
Write-Host "Open on this PC: http://localhost:$port"
Write-Host "Open on other laptop: http://192.168.1.16:$port"
Write-Host ""

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
$listener.Start()

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream)
    $request = $reader.ReadLine()
    do { $line = $reader.ReadLine() } while ($line -ne $null -and $line -ne "")
    if (-not $request) { continue }

    $parts = $request.Split(" ")
    $urlPath = if ($parts.Length -gt 1) { [Uri]::UnescapeDataString($parts[1].Split("?")[0]) } else { "/" }
    if ($urlPath -eq "/") { $urlPath = "/index.html" }

    $relative = $urlPath.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
    $file = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $relative))

    if ((-not $file.StartsWith($root)) -or (-not [System.IO.File]::Exists($file))) {
      $body = [Text.Encoding]::UTF8.GetBytes("Not found")
      $header = "HTTP/1.1 404 Not Found`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
    } else {
      $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
      $type = switch ($ext) {
        ".html" { "text/html; charset=utf-8" }
        ".js" { "application/javascript; charset=utf-8" }
        ".css" { "text/css; charset=utf-8" }
        ".png" { "image/png" }
        ".jpg" { "image/jpeg" }
        ".jpeg" { "image/jpeg" }
        default { "application/octet-stream" }
      }
      $body = [System.IO.File]::ReadAllBytes($file)
      $header = "HTTP/1.1 200 OK`r`nContent-Type: $type`r`nCache-Control: no-store, no-cache, must-revalidate`r`nPragma: no-cache`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
    }

    $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($body, 0, $body.Length)
  } catch {
    Write-Host "Request failed: $($_.Exception.Message)"
  } finally {
    $client.Close()
  }
}
