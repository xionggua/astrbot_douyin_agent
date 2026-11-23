import fs from 'node:fs';

const LOCK='/tmp/douyin_verify_lock.json';
const kept=new Set();

export function cooldownRemaining(){
  try{
    const info=JSON.parse(fs.readFileSync(LOCK,'utf8'));
    const remain=Number(info.until)-Date.now();
    return remain>0?Math.ceil(remain/60000):0;
  }catch{return 0;}
}
export function triggerCooldown(minutes){
  try{fs.writeFileSync(LOCK,JSON.stringify({until:Date.now()+minutes*60000}));}catch{}
}
export function keepOpen(page){kept.add(page);try{page.once('close',()=>kept.delete(page));}catch{}}
export function isKept(page){return kept.has(page);}
export async function detectVerify(tab){
  try{
    const title=String(await tab.title()).trim();
    if(/^(安全验证|账号验证|抖音安全验证)/.test(title)){
      try{fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' 验证判定:标题命中 "'+title.slice(0,40)+'"\n')}catch{}
      return true;
    }
    const visible=await tab.locator('iframe[src*="rc-verifycenter"]').evaluateAll(
      nodes=>nodes.some(node=>{const r=node.getBoundingClientRect();return r.width>50&&r.height>50;})
    ).catch(()=>false);
    if(visible){
      try{fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' 验证判定:可见iframe命中\n')}catch{}
      return true;
    }
    return false;
  }catch{return false;}
}
