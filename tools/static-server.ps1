<#
  static-server.ps1 — tiny local static file server (Windows PowerShell, no installs)

  Purpose: serve this folder over http://localhost so you can
    * open the test runner:   http://localhost:8777/tests/run.html
    * open the dashboard:      http://localhost:8777/index.html

  This is a DEV HELPER ONLY. It is not part of the app and the extension does
  not need it — the extension talks to the file:// dashboard directly.

  Usage:
    powershell -ExecutionPolicy Bypass -File tools\static-server.ps1
    powershell -ExecutionPolicy Bypass -File tools\static-server.ps1 -Port 9000
  Stop with Ctrl+C.
#>
param([int]$Port = 8777)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot   # the my-bookmarks-app folder
$prefix = "http://localhost:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8";
  ".css" = "text/css; charset=utf-8"; ".json" = "application/json; charset=utf-8";
  ".png" = "image/png"; ".svg" = "image/svg+xml"; ".ico" = "image/x-icon";
  ".txt" = "text/plain; charset=utf-8"; ".md" = "text/markdown; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "Serving $root" -ForegroundColor Green
Write-Host "  $prefix" -ForegroundColor Cyan
Write-Host "  ${prefix}tests/run.html" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart("/"))
    if ($rel -eq "") { $rel = "index.html" }
    $full = Join-Path $root $rel
    $resolved = [System.IO.Path]::GetFullPath($full)

    if (-not $resolved.StartsWith([System.IO.Path]::GetFullPath($root))) {
      $ctx.Response.StatusCode = 403
    }
    elseif (Test-Path $resolved -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
      $ctx.Response.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" })
      $bytes = [System.IO.File]::ReadAllBytes($resolved)
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    else {
      $ctx.Response.StatusCode = 404
      $b = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel")
      $ctx.Response.OutputStream.Write($b, 0, $b.Length)
    }
    $ctx.Response.OutputStream.Close()
  }
}
finally {
  $listener.Stop()
  $listener.Close()
}
