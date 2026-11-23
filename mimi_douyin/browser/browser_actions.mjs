import fs from 'node:fs';
// Keep routine chat actions inside the page instead of issuing mouse clicks.
export async function enterReply(page,text) {
  const editor=page.locator('[data-mimi-dm-editor="true"]').first();
  await editor.focus();
  await editor.press('Control+A');
  await editor.press('Backspace');
  await page.keyboard.insertText(text);
  const norm=value=>String(value).replace(/[\u200b\ufeff]/g,'').split(/\n+/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
  const actual=await editor.innerText();
  if(norm(actual)!==norm(text)){
    const cnt=await page.locator('[data-mimi-dm-editor="true"]').count();
    try{fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' 发送校验失败 editors='+cnt+' actual('+actual.length+')='+JSON.stringify(actual.slice(0,120))+' expected('+String(text).length+')='+JSON.stringify(String(text).slice(0,120))+'\n')}catch{}
    throw new Error('输入框未能正确写入，未发送。');
  }
}

export async function submitReply(page) {
  const button=page.locator('.e2e-send-msg-btn:visible');
  if(await button.count()!==1)throw new Error('没有定位到唯一的私信发送按钮。');
  // A single DOM click reaches the page's handler without mouse activation.
  // Never retry this operation if its result or the later send echo is unknown.
  await button.evaluate(node=>{
    if(node.disabled || node.closest('button:disabled,[aria-disabled="true"]'))
      throw new Error('私信发送按钮尚未就绪。');
    if(typeof node.click==='function')node.click();
    else node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
  });
}

export async function sendReply(page,snapshot,args) {
  const before=await snapshot();
  const rejected=(receipt,error)=>({state:'not_sent',receipt,error});
  // These checks finish before touching the editor or attempting a click.
  // Exceptions once dispatch starts must retain the caller's unknown outcome.
  if(!before.ready || before.peer.key!==args.peer_key)
    return rejected('recipient_mismatch','当前私信对象与已绑定对象不一致，未发送。');
  if(args.conversation_type&&before.peer.conversation_type!==args.conversation_type)
    return rejected('conversation_type_changed','会话类型已变化，没有发送。');
  if(!before.direction_proven)return rejected('direction_unconfirmed','尚未确认消息的收发方向，未发送。');
  const text=String(args.text||'').trim();
  if(!text || text.length>2000)return rejected('invalid_text','回复为空或超过当前单条文字限制。');
  const normEcho=v=>String(v).replace(/[\u200b\ufeff]/g,'').split(/\n+/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n'); // ECHONORM_V1：DOM innerText 会把空行合并成单换行，回显比对两边归一化
  const count=before.items.filter(x=>x.sender==='me'&&normEcho(x.text)===normEcho(text)).length;
  await page.bringToFront().catch(()=>{}); // S3FRONT：发送前确保私信页前台
  await enterReply(page,text);
  await submitReply(page);
  for(let i=0;i<10;i++) {
    await page.waitForTimeout(500);
    const after=await snapshot();
    if(!after.ready || after.peer.key!==args.peer_key)return {state:'unknown',receipt:'conversation_changed_after_send'};
    const matches=after.items.filter(x=>x.sender==='me'&&normEcho(x.text)===normEcho(text));
    if(matches.length>count) {
      const last=matches.at(-1);
      if(last.failed)return {state:'failed',receipt:'ui_send_failed'};
      if(!last.pending && i>=2)return {state:'sent',receipt:'ui_own_message_echo',message_key:last.key};
    }
    if(i===9){ // ECHO_DIAG_V1：回显未确认时留下现场
      try{
        const tail=after.items.slice(-4).map(x=>({s:x.sender,t:String(x.text||'').slice(0,20),p:!!x.pending}));
        const ed=await page.evaluate(()=>{const e=document.querySelector('[data-mimi-dm-editor="true"]');return e?String(e.innerText||'').slice(0,40):null;});
        fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' 回显未确认 count='+count+' matches='+matches.length+' text='+JSON.stringify(String(text).slice(0,30))+' tail='+JSON.stringify(tail)+' editor='+JSON.stringify(ed)+'\n');
      }catch{}
    }
  }
  return {state:'unknown',receipt:'no_confirmed_ui_echo'};
}

export async function openBackgroundPage(context,anchor) {
  // This integration uses Chromium's persistent default context. A normal
  // context.newPage() creates an active tab and can activate the browser app.
  const session=await context.newCDPSession(anchor);
  let targetId;
  try {
    const created=context.waitForEvent('page',{timeout:15000});
    created.catch(()=>{});
    ({targetId}=await session.send('Target.createTarget',{url:'about:blank',background:true}));
    const tab=await created;
    const probe=await context.newCDPSession(tab);
    try {
      const {targetInfo}=await probe.send('Target.getTargetInfo');
      if(targetInfo.targetId!==targetId)throw new Error('视频后台标签页未能正确绑定。');
    } finally {await probe.detach();}
    return tab;
  } catch(error) {
    if(targetId)await session.send('Target.closeTarget',{targetId}).catch(()=>{});
    throw error;
  } finally {await session.detach();}
}
