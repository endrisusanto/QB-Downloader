# tools/test-filesize.ps1
# Usage: .\test-filesize.ps1 -BuildId "12345" -Filename "AP_code.tar.md5" -BaseUrl "https://android.qb.sec.samsung.net" -Username "corp\user" -Token "your_token"

param (
    [Parameter(Mandatory=$true)]
    [string]$BuildId,
    
    [Parameter(Mandatory=$true)]
    [string]$Filename,
    
    [Parameter(Mandatory=$false)]
    [string]$BaseUrl = "https://android.qb.sec.samsung.net",
    
    [Parameter(Mandatory=$true)]
    [string]$Username,
    
    [Parameter(Mandatory=$true)]
    [string]$Token
)

$ApiSuffix = "QDgil8FjqA27El7lpOaC3YACGlCzhR9yq4FV1gnyZC"

# Helper to add basic auth header
$AuthPair = "$($Username):$($Token)"
$AuthBytes = [System.Text.Encoding]::UTF8.GetBytes($AuthPair)
$AuthBase64 = [Convert]::ToBase64String($AuthBytes)
$Headers = @{
    "Authorization" = "Basic $AuthBase64"
    "Range"         = "bytes=0-0"
}

# Construct URLs
$DirectUrl = "$BaseUrl/download/$BuildId/$Filename"
if ($DirectUrl -notlike "*$ApiSuffix*") {
    $DirectUrl = "$DirectUrl?_=$ApiSuffix"
}

$Ads5Url = "$BaseUrl/rest/ads5/download/$BuildId?filename=$Filename"
if ($Ads5Url -notlike "*$ApiSuffix*") {
    $Ads5Url = "$Ads5Url&_=$ApiSuffix"
}

$ArtifactUrl = "$BaseUrl/rest/files/artifacts/$BuildId/$Filename"
if ($ArtifactUrl -notlike "*$ApiSuffix*") {
    $ArtifactUrl = "$ArtifactUrl?_=$ApiSuffix"
}

$Urls = @(
    @{ Name = "Direct Download URL"; Url = $DirectUrl },
    @{ Name = "ADS5 Download URL"; Url = $Ads5Url },
    @{ Name = "Artifact REST URL"; Url = $ArtifactUrl }
)

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Testing QuickBuild File Size Resolution" -ForegroundColor Cyan
Write-Host "Build ID: $BuildId"
Write-Host "Filename: $Filename"
Write-Host "Base URL: $BaseUrl"
Write-Host "==================================================" -ForegroundColor Cyan

foreach ($item in $Urls) {
    Write-Host "`nTesting $($item.Name):" -ForegroundColor Yellow
    Write-Host "URL: $($item.Url)" -ForegroundColor Gray
    
    $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        # Using Invoke-WebRequest with 10s timeout
        $Response = Invoke-WebRequest -Uri $item.Url -Headers $Headers -Method Get -TimeoutSec 10 -ErrorAction Stop
        $Stopwatch.Stop()
        
        Write-Host "Status: $($Response.StatusCode) $($Response.StatusDescription)" -ForegroundColor Green
        Write-Host "Time taken: $($Stopwatch.ElapsedMilliseconds) ms" -ForegroundColor Green
        
        $ContentLength = $Response.Headers["Content-Length"]
        $ContentRange = $Response.Headers["Content-Range"]
        
        Write-Host "Headers returned:" -ForegroundColor White
        foreach ($h in $Response.Headers.Keys) {
            Write-Host "  $h: $($Response.Headers[$h])" -ForegroundColor Gray
        }
        
        if ($ContentLength) {
            Write-Host "Content-Length resolved: $ContentLength bytes" -ForegroundColor Green
        } else {
            Write-Host "Content-Length: NOT FOUND" -ForegroundColor Red
        }
        
        if ($ContentRange) {
            Write-Host "Content-Range resolved: $ContentRange" -ForegroundColor Green
        }
        
    } catch {
        $Stopwatch.Stop()
        Write-Host "FAILED or TIMED OUT after $($Stopwatch.ElapsedMilliseconds) ms" -ForegroundColor Red
        Write-Host "Error message: $_" -ForegroundColor Red
    }
}
Write-Host "`n==================================================" -ForegroundColor Cyan
