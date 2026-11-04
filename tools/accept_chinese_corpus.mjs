// The explicit new baseline does not reinstate the withdrawn model oracle.
if(process.argv.slice(2).includes('--visible-window-gate')){
 process.argv=process.argv.map(a=>a==='--visible-window-gate'?'--gate':a);
 await import('./evaluate_visible_windows.mjs');
}else await import('./evaluate_s6_corpus.mjs');
