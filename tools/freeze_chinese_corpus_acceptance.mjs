if(process.argv.slice(2).length===1&&process.argv[2]==='--original-visible-windows'){
 process.argv=process.argv.slice(0,2);await import('./freeze_visible_window_reference.mjs');
}else throw Error('Model-authored Chinese answer freezing is withdrawn. Use --original-visible-windows to freeze the reviewed original RSC source ranges. Historical references remain archived.');
