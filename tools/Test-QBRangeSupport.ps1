[CmdletBinding()]
param(
    [string]$Url,
    [string]$Username,
    [string]$ApiSuffix = "lhPvXc5AgyVjwjucNS5rdLCECzu856BOvROUai8d",
    [ValidateRange(1024, 16777216)]
    [int]$TestPartSize = 1048576
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Centered {
    param([string]$Text, [ConsoleColor]$Color = [ConsoleColor]::White)
    $width = [Math]::Max(40, [Console]::WindowWidth)
    $padding = [Math]::Max(0, [Math]::Floor(($width - $Text.Length) / 2))
    Write-Host ((" " * $padding) + $Text) -ForegroundColor $Color
}

function Write-Header {
    Clear-Host
    Write-Host ("=" * 72) -ForegroundColor DarkGray
    Write-Centered "QuickBuild HTTP Range / Multipart Probe" Cyan
    Write-Centered "Validates resume and concurrent range support" DarkGray
    Write-Host ("=" * 72) -ForegroundColor DarkGray
    Write-Host
}

function Write-Step {
    param([string]$Label, [string]$State, [ConsoleColor]$Color)
    Write-Host ("  {0,-37}" -f $Label) -NoNewline
    Write-Host ("[{0}]" -f $State) -ForegroundColor $Color
}

function Read-RequiredValue {
    param([string]$Prompt, [string]$CurrentValue = "")
    while ($true) {
        $suffix = if ($CurrentValue) { " [$CurrentValue]" } else { "" }
        $value = Read-Host "$Prompt$suffix"
        if ([string]::IsNullOrWhiteSpace($value)) { $value = $CurrentValue }
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
        Write-Host "Value is required." -ForegroundColor Yellow
    }
}

function Read-HttpUrl {
    param([string]$CurrentValue = "")
    while ($true) {
        $value = Read-RequiredValue "Full artifact download URL" $CurrentValue
        $uri = $null
        if ([Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$uri) -and $uri.Scheme -in @("http", "https")) {
            if ($uri.AbsolutePath -match "^/build/") {
                Write-Host "This is a build page URL, not an artifact download URL." -ForegroundColor Yellow
                Write-Host "Use a URL containing /download/{build_id}/{filename} or /rest/ads5/download/{build_id}?filename=..." -ForegroundColor DarkGray
                $CurrentValue = ""
                continue
            }
            return $value
        }
        Write-Host "URL must be an absolute HTTP or HTTPS URL." -ForegroundColor Yellow
        $CurrentValue = ""
    }
}

function Test-ArtifactDownloadUrl {
    param([string]$Value)
    $uri = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri)) { return $false }
    if ($uri.Scheme -notin @("http", "https")) { return $false }
    return $uri.AbsolutePath -match "^/(download/|rest/ads5/download/)"
}

function Show-ArtifactUrlHelp {
    Write-Host "The test requires a direct artifact URL, not a build page." -ForegroundColor Yellow
    Write-Host "Accepted URL patterns:" -ForegroundColor DarkGray
    Write-Host "  https://server/download/BUILD_ID/ARTIFACT_NAME" -ForegroundColor DarkGray
    Write-Host "  https://server/rest/ads5/download/BUILD_ID?filename=ARTIFACT_NAME&source=HOST" -ForegroundColor DarkGray
}

function Add-ApiSuffix {
    param([string]$Value, [string]$Suffix)
    $cleanSuffix = $Suffix.Trim().TrimStart([char[]]"?&")
    if ([string]::IsNullOrWhiteSpace($cleanSuffix)) { return $Value }

    $escapedSuffix = [Regex]::Escape($cleanSuffix)
    if ($Value -match "(?:[?&])$escapedSuffix(?:[&#]|$)") { return $Value }

    $separator = if ($Value.Contains("?")) { "&" } else { "?" }
    return "${Value}${separator}${cleanSuffix}"
}

function Convert-SecureStringToPlainText {
    param([Security.SecureString]$SecureValue)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Get-BasicAuthorization {
    param([string]$User, [Security.SecureString]$Token)
    $plainToken = Convert-SecureStringToPlainText $Token
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes("${User}:${plainToken}")
        return "Basic $([Convert]::ToBase64String($bytes))"
    }
    finally {
        $plainToken = $null
    }
}

function Invoke-RangeRequest {
    param(
        [string]$RequestUrl,
        [string]$Authorization,
        [long]$Start,
        [long]$End,
        [string]$OutputPath
    )

    $request = [Net.HttpWebRequest]::Create($RequestUrl)
    $request.Method = "GET"
    $request.AllowAutoRedirect = $true
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 30000
    $request.UserAgent = "QB-Downloader-Range-Probe/1.0"
    $request.Headers["Authorization"] = $Authorization
    $request.AddRange($Start, $End)

    $response = $null
    $stream = $null
    $file = $null
    try {
        $response = [Net.HttpWebResponse]$request.GetResponse()
        $bytesWritten = 0L
        $expectedLength = $End - $Start + 1

        # Never consume a full artifact when the server ignores Range and returns HTTP 200.
        if ([int]$response.StatusCode -eq 206) {
            $stream = $response.GetResponseStream()
            $file = [IO.File]::Open($OutputPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
            $buffer = New-Object byte[] 65536
            while ($bytesWritten -lt $expectedLength) {
                $remaining = $expectedLength - $bytesWritten
                $readSize = [int][Math]::Min($buffer.Length, $remaining)
                $read = $stream.Read($buffer, 0, $readSize)
                if ($read -le 0) { break }
                $file.Write($buffer, 0, $read)
                $bytesWritten += $read
            }
        }

        return [pscustomobject]@{
            Success       = $true
            StatusCode    = [int]$response.StatusCode
            Status        = $response.StatusDescription
            ContentRange  = $response.Headers["Content-Range"]
            ContentLength = $response.ContentLength
            AcceptRanges  = $response.Headers["Accept-Ranges"]
            ETag          = $response.Headers["ETag"]
            LastModified  = $response.Headers["Last-Modified"]
            BytesWritten  = $bytesWritten
            Error         = $null
        }
    }
    catch [Net.WebException] {
        $errorResponse = $_.Exception.Response
        return [pscustomobject]@{
            Success       = $false
            StatusCode    = if ($errorResponse) { [int]$errorResponse.StatusCode } else { 0 }
            Status        = if ($errorResponse) { $errorResponse.StatusDescription } else { "Network error" }
            ContentRange  = if ($errorResponse) { $errorResponse.Headers["Content-Range"] } else { $null }
            ContentLength = if ($errorResponse) { $errorResponse.ContentLength } else { -1 }
            AcceptRanges  = if ($errorResponse) { $errorResponse.Headers["Accept-Ranges"] } else { $null }
            ETag          = if ($errorResponse) { $errorResponse.Headers["ETag"] } else { $null }
            LastModified  = if ($errorResponse) { $errorResponse.Headers["Last-Modified"] } else { $null }
            BytesWritten  = 0
            Error         = $_.Exception.Message
        }
    }
    finally {
        if ($file) { $file.Dispose() }
        if ($stream) { $stream.Dispose() }
        if ($response) { $response.Dispose() }
    }
}

function Test-RangeResponse {
    param($Result, [long]$ExpectedStart, [long]$ExpectedEnd)
    $expectedLength = $ExpectedEnd - $ExpectedStart + 1
    $expectedPrefix = "bytes $ExpectedStart-$ExpectedEnd/"
    return $Result.Success -and
        $Result.StatusCode -eq 206 -and
        $Result.ContentRange -and
        $Result.ContentRange.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase) -and
        $Result.BytesWritten -eq $expectedLength
}

function Show-ResponseDetails {
    param([string]$Name, $Result)
    Write-Host
    Write-Host "  $Name" -ForegroundColor Cyan
    Write-Host "    HTTP status    : $($Result.StatusCode) $($Result.Status)"
    Write-Host "    Content-Range  : $($Result.ContentRange)"
    Write-Host "    Content-Length : $($Result.ContentLength)"
    Write-Host "    Accept-Ranges  : $($Result.AcceptRanges)"
    Write-Host "    ETag           : $($Result.ETag)"
    Write-Host "    Last-Modified  : $($Result.LastModified)"
    Write-Host "    Bytes received : $($Result.BytesWritten)"
    if ($Result.Error) { Write-Host "    Error          : $($Result.Error)" -ForegroundColor Red }
}

function Show-FailureSummary {
    param([string]$Name, $Result, [long]$ExpectedStart, [long]$ExpectedEnd)
    $expectedLength = $ExpectedEnd - $ExpectedStart + 1
    Write-Host ("    {0}: HTTP {1}; Content-Range={2}; bytes={3}/{4}" -f `
        $Name,
        $Result.StatusCode,
        $(if ($Result.ContentRange) { $Result.ContentRange } else { "<missing>" }),
        $Result.BytesWritten,
        $expectedLength) -ForegroundColor DarkYellow
    if ($Result.Error) {
        Write-Host "    Error: $($Result.Error)" -ForegroundColor Red
    }
}

function Get-ProbeVerdict {
    param($Results, [bool]$ProbeOk, [bool]$OffsetOk, [bool]$ParallelOk, [bool]$ValidatorStable)
    $statusCodes = @($Results | ForEach-Object { [int]$_.StatusCode })
    if (@($statusCodes | Where-Object { $_ -eq 401 }).Length -gt 0) { return "UNAUTHORIZED" }
    if (@($statusCodes | Where-Object { $_ -eq 403 }).Length -gt 0) { return "FORBIDDEN" }
    if (@($statusCodes | Where-Object { $_ -eq 404 }).Length -gt 0) { return "NOT_FOUND" }
    if ($ProbeOk -and $OffsetOk -and $ParallelOk -and $ValidatorStable) { return "SUPPORTED" }
    if ($ProbeOk -and $OffsetOk) { return "PARTIAL" }
    if (@($statusCodes | Where-Object { $_ -eq 200 }).Length -gt 0) { return "RANGE_IGNORED" }
    return "UNSUPPORTED"
}

function Invoke-Probe {
    param(
        [string]$RequestUrl,
        [string]$User,
        [Security.SecureString]$Token,
        [int]$PartSize
    )

    $authorization = Get-BasicAuthorization $User $Token
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("qb-range-probe-" + [Guid]::NewGuid().ToString("N"))
    [IO.Directory]::CreateDirectory($tempRoot) | Out-Null

    try {
        Write-Host "Testing: $RequestUrl" -ForegroundColor Gray
        Write-Host "QuickBuild API suffix is appended automatically when missing." -ForegroundColor DarkGray
        Write-Host

        $probe = Invoke-RangeRequest $RequestUrl $authorization 0 0 (Join-Path $tempRoot "probe.bin")
        $probeOk = Test-RangeResponse $probe 0 0
        Write-Step "Single-byte range (0-0)" $(if ($probeOk) { "PASS" } else { "FAIL" }) $(if ($probeOk) { "Green" } else { "Red" })
        if (-not $probeOk) { Show-FailureSummary "Probe" $probe 0 0 }

        $offsetStart = $PartSize
        $offsetEnd = $PartSize + 1023
        $offset = Invoke-RangeRequest $RequestUrl $authorization $offsetStart $offsetEnd (Join-Path $tempRoot "offset.bin")
        $offsetOk = Test-RangeResponse $offset $offsetStart $offsetEnd
        Write-Step "Non-zero offset range" $(if ($offsetOk) { "PASS" } else { "FAIL" }) $(if ($offsetOk) { "Green" } else { "Red" })
        if (-not $offsetOk) { Show-FailureSummary "Offset" $offset $offsetStart $offsetEnd }

        $part1Path = Join-Path $tempRoot "part1.bin"
        $part2Path = Join-Path $tempRoot "part2.bin"
        $part1Start = 0
        $part1End = $PartSize - 1
        $part2Start = $PartSize
        $part2End = ($PartSize * 2) - 1

        $job1 = Start-Job -ScriptBlock ${function:Invoke-RangeRequest} -ArgumentList $RequestUrl, $authorization, $part1Start, $part1End, $part1Path
        $job2 = Start-Job -ScriptBlock ${function:Invoke-RangeRequest} -ArgumentList $RequestUrl, $authorization, $part2Start, $part2End, $part2Path
        try {
            Wait-Job -Job $job1, $job2 -Timeout 90 | Out-Null
            if ($job1.State -ne "Completed" -or $job2.State -ne "Completed") {
                Stop-Job -Job $job1, $job2 -ErrorAction SilentlyContinue
            }
            $part1 = Receive-Job -Job $job1
            $part2 = Receive-Job -Job $job2
        }
        finally {
            Remove-Job -Job $job1, $job2 -Force -ErrorAction SilentlyContinue
        }

        if (-not $part1) { $part1 = [pscustomobject]@{ Success = $false; StatusCode = 0; Status = "No response"; ContentRange = $null; ContentLength = -1; AcceptRanges = $null; ETag = $null; LastModified = $null; BytesWritten = 0; Error = "Concurrent request timed out." } }
        if (-not $part2) { $part2 = [pscustomobject]@{ Success = $false; StatusCode = 0; Status = "No response"; ContentRange = $null; ContentLength = -1; AcceptRanges = $null; ETag = $null; LastModified = $null; BytesWritten = 0; Error = "Concurrent request timed out." } }

        $part1Ok = Test-RangeResponse $part1 $part1Start $part1End
        $part2Ok = Test-RangeResponse $part2 $part2Start $part2End
        $parallelOk = $part1Ok -and $part2Ok
        Write-Step "Two concurrent range requests" $(if ($parallelOk) { "PASS" } else { "FAIL" }) $(if ($parallelOk) { "Green" } else { "Red" })
        if (-not $part1Ok) { Show-FailureSummary "Part 1" $part1 $part1Start $part1End }
        if (-not $part2Ok) { Show-FailureSummary "Part 2" $part2 $part2Start $part2End }

        $validatorStable = $true
        $validators = [Collections.ArrayList]::new()
        foreach ($candidate in @($probe.ETag, $offset.ETag, $part1.ETag, $part2.ETag)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
                [void]$validators.Add([string]$candidate)
            }
        }
        if ($validators.Count -gt 1) {
            $validatorStable = @($validators | Select-Object -Unique).Length -eq 1
        }
        Write-Step "Stable ETag when available" $(if ($validatorStable) { "PASS" } else { "WARN" }) $(if ($validatorStable) { "Green" } else { "Yellow" })

        $verdict = Get-ProbeVerdict `
            -Results @($probe, $offset, $part1, $part2) `
            -ProbeOk $probeOk `
            -OffsetOk $offsetOk `
            -ParallelOk $parallelOk `
            -ValidatorStable $validatorStable

        Write-Host
        switch ($verdict) {
            "SUPPORTED" {
                Write-Centered "SUPPORTED: safe candidate for adaptive multipart" Green
                Write-Host "  Server honors offsets and concurrent range requests." -ForegroundColor Green
            }
            "PARTIAL" {
                Write-Centered "PARTIAL: use single-stream resume only" Yellow
                Write-Host "  Range works, but concurrent multipart or validator checks were not reliable." -ForegroundColor Yellow
            }
            "UNAUTHORIZED" {
                Write-Centered "AUTH ERROR: username or access token was rejected" Red
                Write-Host "  Verify the same credentials work in QB Downloader." -ForegroundColor Red
            }
            "FORBIDDEN" {
                Write-Centered "FORBIDDEN: account cannot access this artifact" Red
                Write-Host "  The server accepted authentication but denied artifact access." -ForegroundColor Red
            }
            "NOT_FOUND" {
                Write-Centered "NOT FOUND: artifact URL is invalid or expired" Red
                Write-Host "  Fetch the build again and use its current artifact URL." -ForegroundColor Red
            }
            "RANGE_IGNORED" {
                Write-Centered "RANGE IGNORED: server returned the full response" Yellow
                Write-Host "  HTTP 200 for a Range request means multipart and reliable resume are unavailable." -ForegroundColor Yellow
            }
            default {
                Write-Centered "UNSUPPORTED: do not enable resume or multipart" Red
                Write-Host "  Server did not return valid HTTP 206 Content-Range responses." -ForegroundColor Red
            }
        }

        return [pscustomobject]@{
            Verdict = $verdict
            Probe = $probe
            Offset = $offset
            Part1 = $part1
            Part2 = $part2
        }
    }
    finally {
        $authorization = $null
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$token = $null
$lastResult = $null

while ($true) {
    Write-Header
    if ([string]::IsNullOrWhiteSpace($Url)) {
        $Url = Read-HttpUrl
    }
    if ([string]::IsNullOrWhiteSpace($Username)) {
        $Username = Read-RequiredValue "Username"
    }
    if (-not $token) {
        $token = Read-Host "Access token" -AsSecureString
    }

    Write-Host
    Write-Host "  [1] Run complete test" -ForegroundColor White
    Write-Host "  [2] Change URL" -ForegroundColor White
    Write-Host "  [3] Change credentials" -ForegroundColor White
    Write-Host "  [4] Show last response headers" -ForegroundColor White
    Write-Host "  [Q] Quit" -ForegroundColor White
    Write-Host
    $choice = (Read-Host "Select").Trim().ToUpperInvariant()

    switch ($choice) {
        "1" {
            Write-Header
            if (-not (Test-ArtifactDownloadUrl $Url)) {
                Show-ArtifactUrlHelp
                $Url = ""
            } else {
                $requestUrl = Add-ApiSuffix $Url $ApiSuffix
                $lastResult = Invoke-Probe $requestUrl $Username $token $TestPartSize
            }
            Write-Host
            Read-Host "Press Enter to return to menu" | Out-Null
        }
        "2" { $Url = "" }
        "3" { $Username = ""; $token = $null }
        "4" {
            Write-Header
            if (-not $lastResult) {
                Write-Host "No test result available. Run the complete test first." -ForegroundColor Yellow
            } else {
                Show-ResponseDetails "Probe 0-0" $lastResult.Probe
                Show-ResponseDetails "Offset probe" $lastResult.Offset
                Show-ResponseDetails "Concurrent part 1" $lastResult.Part1
                Show-ResponseDetails "Concurrent part 2" $lastResult.Part2
            }
            Write-Host
            Read-Host "Press Enter to return to menu" | Out-Null
        }
        "Q" { break }
        default {
            Write-Host "Unknown selection." -ForegroundColor Yellow
            Start-Sleep -Milliseconds 700
        }
    }

    if ($choice -eq "Q") { break }
}

$token = $null
Clear-Host
Write-Host "QuickBuild range probe closed." -ForegroundColor Cyan
