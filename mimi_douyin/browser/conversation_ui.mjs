// Select only an observed, uniquely matched IM row. No message is sent here.
export async function activateConversation(page,choice,snapshot){
const row=page.locator('[data-mimi-chat-index="'+choice.index+'"]');
const {execSync}=await import('node:child_process');
const fs=await import('node:fs');
const rect=await page.evaluate(idx=>{
  const el=document.querySelector('[data-mimi-chat-index="'+idx+'"]');
  if(!el)return null;
  el.scrollIntoView({block:'center'});
  const r=el.getBoundingClientRect();
  const ok=r.y>=0&&r.y+r.height<=600&&r.width>0;
  return {x:r.x+r.width/2,y:r.y+r.height/2,ok};
},choice.index);
fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' activate: index='+choice.index+' event='+choice.activation_event+' rect='+(rect?rect.x+','+rect.y:'null')+' visible='+(rect?(rect.ok?'yes':'NO'):'null')+'\n');
if(rect&&rect.ok){
  try{
    const remote=!!process.env.DOUYIN_REMOTE;
    const offsetY=Number(process.env.DOUYIN_CLICK_OFFSET_Y)||80;
    execSync((remote?''+'ssh -i '+(process.env.DOUYIN_VM_SSH_KEY||'/root/.ssh/douyin_vm')+' -p '+(process.env.DOUYIN_VM_SSH_PORT||'2222')+' -o BatchMode=yes -o StrictHostKeyChecking=accept-new '+(process.env.DOUYIN_VM_SSH_USER||'root')+'@'+(process.env.DOUYIN_VM_SSH_HOST||'127.0.0.1')+' "DISPLAY=:99 xdotool ':'DISPLAY=:99 xdotool ')+'mousemove '+Math.round(rect.x)+' '+(Math.round(rect.y)+offsetY)+' click 1'+(remote?'"':''));
    fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' activate: xdotool clicked\n');
  }catch(e){
    fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' activate: xdotool failed: '+e.message+'\n');
    await row.dispatchEvent(choice.activation_event==='mousedown'?'mousedown':'click',{button:0});
  }
}else{
  await row.dispatchEvent(choice.activation_event==='mousedown'?'mousedown':'click',{button:0});
}
let selected;
for(let attempt=0;attempt<40;attempt++){
await page.waitForTimeout(250);
selected=await snapshot();
if(selected.ready&&selected.peer?.conversation_id===choice.conversation_id)return selected;
}
throw new Error('会话切换尚未确认，未处理或发送消息；请确认消息面板仍打开。');
}
