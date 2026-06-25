@echo off
setlocal

cd /d "%~dp0android"

set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"
set "JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT"

echo Building FA Reader Android debug APK...
echo Project: %CD%
echo.

call gradlew.bat clean assembleDebug --no-daemon --max-workers=1 -Dorg.gradle.parallel=false

echo.
if exist "build\app\outputs\apk\debug\app-debug.apk" (
  echo APK ready:
  echo %CD%\build\app\outputs\apk\debug\app-debug.apk
) else (
  echo APK belum terbentuk. Cek error Gradle di atas.
)

echo.
pause
