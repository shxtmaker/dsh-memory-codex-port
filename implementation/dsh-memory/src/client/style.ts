/** 字体、字号与控件尺寸沿用宿主设置页；布局仅作用于记忆页。 */
export const css=`
.dm-page{max-width:720px;margin:0;padding:0;color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:14px;font-weight:400;line-height:22px}
.dm-page h2{margin:0;font-size:16px;line-height:24px;font-weight:500}
.dm-page h3{margin:24px 0 12px;font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-secondary,inherit)}
.dm-usage-stat strong{font-weight:500}
.dm-page h4{margin:20px 0 8px;font-size:14px;line-height:22px;font-weight:500}
.dm-page p{margin:8px 0;line-height:22px;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere}
.dm-page small,.dm-muted{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,inherit)}
.dm-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
.dm-card{border:.5px solid var(--dsw-alias-settings-card-stroke,#8886);border-radius:var(--dsw-radius-xl,12px);padding:0 14px;background:var(--dsw-alias-settings-card-fill,transparent)}
.dm-row{display:flex;align-items:center;gap:12px;padding:16px 0}
.dm-row+.dm-row{border-top:.5px solid var(--dsw-alias-border-l3,#8886)}
.dm-grow{flex:1;min-width:0}
.dm-grow strong{font-size:14px;line-height:22px;font-weight:500}
.dm-grow small{display:block;overflow-wrap:anywhere}
.dm-grow p{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,inherit)}
.dm-switch{appearance:none;width:44px;height:26px;border-radius:20px;background:var(--dsw-alias-switch-off-fill,#7776);position:relative;cursor:pointer;flex-shrink:0;margin:0}
.dm-switch:checked{background:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#479d62)}
.dm-switch:after{content:'';position:absolute;width:20px;height:20px;left:3px;top:3px;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#fff)}
.dm-switch:checked:after{left:21px}
.dm-page button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:36px;margin:0;padding:0 14px;border:.5px solid var(--dsw-alias-border-l3,#8886);border-radius:var(--dsw-radius-md,8px);background:transparent;color:inherit;font-family:inherit;font-size:14px;font-weight:400;line-height:22px;cursor:pointer}
.dm-row>button,.dm-fields>button,.dm-setting-line>button{align-self:center;min-height:36px;max-height:36px;flex-shrink:0;white-space:nowrap}
.dm-page button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#8882)}
.dm-page button:disabled,.dm-page input:disabled,.dm-page select:disabled{opacity:.4;cursor:default}
.dm-page .dm-danger{color:var(--dsw-alias-state-error-primary,#ec6262)}
.dm-page .dm-warning{color:var(--dsw-alias-state-warn-label,#dca34c)}
.dm-page .dm-error{color:var(--dsw-alias-state-error-primary,#ee7474)}
.dm-fields{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0}
.dm-fields strong{font-size:14px;font-weight:500;line-height:22px}
.dm-page label{display:block;font-size:14px;line-height:22px}
.dm-page label:has(input[type=checkbox]){display:inline-flex;align-items:center;gap:6px}
.dm-page input[type=checkbox]:not(.dm-switch){width:16px;height:16px;margin:0;flex-shrink:0;accent-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#479d62)}
.dm-page input:not([type=checkbox]),.dm-page select,.dm-page textarea{display:block;box-sizing:border-box;width:100%;height:36px;margin:6px 0 0;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l3,#8886);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;font-family:inherit;font-size:14px;font-weight:400;line-height:22px}
.dm-page select option{background:var(--dsw-alias-bg-layer-2,#fff);color:inherit}
.dm-page textarea{height:auto;min-height:230px;resize:vertical}
.dm-setting-line{display:grid;grid-template-columns:minmax(0,1fr) 132px;align-items:center;gap:12px;margin:16px 0}
.dm-route-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;min-width:0}
.dm-setting-line label{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:8px;min-width:0;white-space:nowrap}
.dm-page .dm-setting-line select,.dm-page .dm-setting-line input{min-width:0;min-height:36px;max-height:36px;margin:0;align-self:center}
.dm-setting-line select{overflow:hidden;text-overflow:ellipsis}
.dm-setting-line .dm-save-action{grid-column:2;width:132px;white-space:nowrap}
.dm-advanced{margin:24px 0}
.dm-advanced summary{cursor:pointer;font-size:14px;line-height:22px;font-weight:500}
.dm-empty{padding:8px}
.dm-override{font-size:12px!important;line-height:18px!important}
.dm-evidence small{display:block;overflow-wrap:anywhere}
.dm-jobs{margin:8px 0 12px;padding-left:20px}
.dm-jobs li{overflow-wrap:anywhere}
.dm-overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1,#0008);z-index:10000;display:grid;place-items:center;padding:24px}
.dm-browser,.dm-confirm{background:var(--dsw-alias-bg-layer-2,#202422);border:.5px solid var(--dsw-alias-border-l3,#8886);border-radius:var(--dsw-radius-panel,16px);width:min(1100px,96vw);max-height:90vh;overflow:auto;padding:24px;box-sizing:border-box}
.dm-confirm{width:520px}
.dm-browser-grid{display:grid;grid-template-columns:240px 1fr;gap:24px}
.dm-browser aside button{display:flex;text-align:left;justify-content:flex-start;width:100%;height:auto;min-height:36px;margin-bottom:8px;overflow-wrap:anywhere}
.dm-browser pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:18px}
.dm-browser code{font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dm-page button:focus-visible,.dm-page input:focus-visible,.dm-page select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color,#66b57d);outline-offset:3px}
@media(max-width:700px){.dm-row{gap:10px;flex-wrap:wrap}.dm-browser-grid{grid-template-columns:1fr}.dm-browser aside{max-height:160px;overflow:auto}}

`
