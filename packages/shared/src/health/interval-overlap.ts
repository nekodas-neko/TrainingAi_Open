export function selectNonOverlapping<T extends {startMs:number;endMs:number}>(windows:readonly T[],value:(window:T)=>number):T[]{
  const accepted:T[]=[];
  for(const window of [...windows].sort((a,b)=>value(b)-value(a)||a.startMs-b.startMs)){
    if(!accepted.some(other=>window.startMs<other.endMs&&window.endMs>other.startMs)){accepted.push(window);}
  }
  return accepted;
}
