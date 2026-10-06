// Synthetic Sheets values and deliberately different display formatting.
// Never connects to Google; escaped formula text is returned as literal text.
function sheetValues(row,start,count){
  return Array.from({length:count},(_,i)=>{
    const value=row?.[start+i]??'';
    if(value instanceof Date)return new Date(value.getTime());
    return typeof value==='string' && /^'[=+\-@'\t\r\n]/.test(value)?value.slice(1):value;
  });
}
function sheetDisplay(row,start,count,formats=[]){
  return sheetValues(row,start,count).map((value,i)=>{
    if(typeof value==='boolean')return value?'TRUE':'FALSE';
    if(value instanceof Date)return formats[start+i]==='yyyy-mm-dd' ? new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(value) : new Intl.DateTimeFormat('de-DE',{timeZone:'America/Mexico_City',dateStyle:'short',timeStyle:'medium'}).format(value);
    if(typeof value==='number')return new Intl.NumberFormat('de-DE',{minimumFractionDigits:2}).format(value);
    return value;
  });
}
function sheetWriteMethods(rows,row,col,count,formats){return {
  getNumberFormats:()=>[Array.from({length:count},(_,i)=>formats[row-1]?.[col-1+i]??'General')],
  setNumberFormats(values){
    if(values.length!==1||values[0].length!==count)throw Error('Synthetic format dimensions');
    formats[row-1]??=[];values[0].forEach((value,i)=>{formats[row-1][col-1+i]=value;});return this;
  },
  setValues(values){
    if(values.length!==1||values[0].length!==count)throw Error('Synthetic value dimensions');
    rows[row-1]??=[];
    values[0].forEach((value,i)=>{
      if(typeof value==='string'&&value.startsWith('='))throw Error('Synthetic executable formula');
      const format=formats[row-1]?.[col-1+i];
      // Model automatic conversion when text format is missing, not String(rawValue).
      if(typeof value==='string'&&format!=='@'){
        if(/^\d{4}-\d{2}-\d{2}$/.test(value))value=new Date(value+'T06:00:00.000Z');
        else if(/^(true|false)$/i.test(value))value=value.toLowerCase()==='true';
        else if(/^\d+(\.\d+)?$/.test(value))value=Number(value);
      }
      rows[row-1][col-1+i]=value;
    });return this;
  }
};}
module.exports={sheetValues,sheetDisplay,sheetWriteMethods};
