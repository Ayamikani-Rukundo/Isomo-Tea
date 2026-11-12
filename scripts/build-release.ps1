param(
  [string]$Version = '1.1.0'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidDirectory = Join-Path $projectRoot 'android'
$outputDirectory = Join-Path $projectRoot 'New folder\built'
$keystorePath = Join-Path $projectRoot 'New folder\isomo-tea-release.jks'
$javaHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot'
$androidHome = Join-Path $env:LOCALAPPDATA 'Android\Sdk'

if ($Version -notmatch '^\d+\.\d+(\.\d+)?$') {
  throw 'Version must use a numeric format such as 1.1.0.'
}
$gradleFile = Join-Path $androidDirectory 'app\build.gradle'
$gradleContents = Get-Content -LiteralPath $gradleFile -Raw
$gradleVersionMatch = [regex]::Match($gradleContents, 'versionName\s+"([^"]+)"')
if (-not $gradleVersionMatch.Success) {
  throw "Could not read versionName from $gradleFile."
}
$gradleVersion = $gradleVersionMatch.Groups[1].Value
if ($Version -ne $gradleVersion) {
  throw "Release output version $Version does not match android\app\build.gradle versionName $gradleVersion. Update both before building."
}
if (-not (Test-Path -LiteralPath $keystorePath -PathType Leaf)) {
  throw "Release keystore not found: $keystorePath"
}
if (-not (Test-Path -LiteralPath (Join-Path $javaHome 'bin\java.exe') -PathType Leaf)) {
  throw "JDK 21 not found at $javaHome. Update the javaHome path in this script."
}
if (-not (Test-Path -LiteralPath $androidHome -PathType Container)) {
  throw "Android SDK not found at $androidHome."
}

$outputApk = Join-Path $outputDirectory "IsomoTea-$Version.apk"
if (Test-Path -LiteralPath $outputApk) {
  throw "Output already exists: $outputApk. Choose another -Version or move the existing APK first."
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

Push-Location -LiteralPath $projectRoot
try {
  & npm.cmd run android:sync
  if ($LASTEXITCODE -ne 0) {
    throw 'Android web assets failed to build or sync.'
  }

  Push-Location -LiteralPath $androidDirectory
  try {
    & .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) {
      throw 'Gradle failed to build the unsigned release APK.'
    }
  }
  finally {
    Pop-Location
  }
}
finally {
  Pop-Location
}

$unsignedApk = Join-Path $androidDirectory 'app\build\outputs\apk\release\app-release-unsigned.apk'
if (-not (Test-Path -LiteralPath $unsignedApk -PathType Leaf)) {
  throw "Unsigned release APK not found: $unsignedApk"
}

$buildToolsDirectory = Join-Path $androidHome 'build-tools'
$latestBuildTools = Get-ChildItem -LiteralPath $buildToolsDirectory -Directory |
  Sort-Object { [version]$_.Name } -Descending |
  Select-Object -First 1
if (-not $latestBuildTools) {
  throw "No Android build-tools installation found in $buildToolsDirectory."
}

$apksigner = Join-Path $latestBuildTools.FullName 'apksigner.bat'
if (-not (Test-Path -LiteralPath $apksigner -PathType Leaf)) {
  throw "apksigner not found: $apksigner"
}

& $apksigner sign --ks $keystorePath --ks-key-alias isomo-tea --out $outputApk $unsignedApk
if ($LASTEXITCODE -ne 0) {
  throw 'APK signing failed.'
}

& $apksigner verify --verbose $outputApk
if ($LASTEXITCODE -ne 0) {
  throw 'Signed APK verification failed.'
}

Write-Host "Verified signed APK: $outputApk"
