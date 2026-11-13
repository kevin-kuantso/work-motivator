# 桌面版

此子專案將根目錄同一套前端來源打包成 Electron 應用程式；不改變 HTML 版的建置流程或預設設定。

```sh
npm --prefix electron install
npm run desktop:start
```

可產生 macOS DMG 或 Windows x64 NSIS：

```sh
npm --prefix electron run package:mac
npm --prefix electron run package:win
```

桌面版的小窗可自由拖曳並會被限制在目前螢幕的可用工作區。主視窗左側會同步小窗的實際尺寸。備份選單只匯出本程式的 `work-motivator-v1` 設定；匯入前會建立 `restore-safety.json` 安全備份。選單的繁簡文字依設定內的地區欄位切換，不讀取系統語言。

「基本設定 → 畫面設定」可在桌面版啟用開機自動啟動並直接開啟小窗。這是系統登入項，不會匯出到備份；系統停用或要求核准時，請在 macOS／Windows 系統設定中處理。實際登入、Windows 安裝升級與解除安裝的登入項清理仍須在兩平台打包版手動驗證。
