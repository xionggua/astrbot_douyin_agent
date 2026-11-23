// Private-chat DOM selectors were informed by popohuan/douyin-bot (MIT).
// See ATTRIBUTIONS.md. No third-party persona, account state, or sending code is used.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import readline from 'node:readline';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sendReply,openBackgroundPage} from './browser_actions.mjs';
import {ConversationIdentities} from './conversation_identity.mjs';

let context, page, settings, identities, identityFile;
const xdoPrefix=remote=>remote?''+'ssh -i '+(process.env.DOUYIN_VM_SSH_KEY||'/root/.ssh/douyin_vm')+' -p '+(process.env.DOUYIN_VM_SSH_PORT||'2222')+' -o BatchMode=yes -o StrictHostKeyChecking=accept-new '+(process.env.DOUYIN_VM_SSH_USER||'root')+'@'+(process.env.DOUYIN_VM_SSH_HOST||'127.0.0.1')+' "DISPLAY=:99 xdotool ':'DISPLAY=:99 xdotool ';
const xdoSuffix=remote=>remote?'"':'';
const clickOffsetY=config=>Number(config&&config.click_offset_y)||80;
const hash=x=>createHash('sha256').update(x).digest('hex');
const siteHost=host=>host==='douyin.com'||host.endsWith('.douyin.com')||host==='iesdouyin.com'||host.endsWith('.iesdouyin.com');
const mediaHost=host=>siteHost(host)||['douyinvod.com','douyincdn.com','douyinpic.com','bytecdn.cn','byteimg.com','byteimgtos.com','pstatp.com'].some(x=>host===x||host.endsWith('.'+x));
const publicURL=value=>{try{const u=new URL(value);return u.origin+u.pathname;}catch{return '';}};

async function open(config) {
  settings=config;
  identityFile=path.join(config.profile,'conversation-identities.json');
  let known={};
  try { known=JSON.parse(await fs.readFile(identityFile,'utf8')); }
  catch(error) { if(error.code!=='ENOENT')throw new Error('会话身份记录无法读取，请保留该文件并检查浏览器资料目录。'); }
  identities=new ConversationIdentities(hash,publicURL,known,config.private_whitelist||[]);
  if(config.restore_peer)identities.remember(config.restore_peer,config.restore_peer.key);
  await fs.mkdir(config.profile,{recursive:true});
  await saveIdentities();
  if(context && page && !page.isClosed())return status();
  const require=createRequire(config.playwright_package);
  const {chromium}=require('playwright');
  await fs.mkdir(config.profile,{recursive:true});
  await fs.mkdir(config.media_dir,{recursive:true});
  if(!config.remote_cdp&&process.platform==='linux'&&!config.headless&&!process.env.DISPLAY&&!process.env.WAYLAND_DISPLAY){
    // XVFBAUTO_V1：无显示环境时自动拉起 Xvfb :99 虚拟屏（统一底座；观察层见设置页虚拟屏套件）
    const {execSync}=await import('node:child_process');
    const fsSync=await import('node:fs');
    try{
      execSync('command -v Xvfb',{stdio:'ignore'}); // 未装 Xvfb 则走 fallback 报错
      try{ execSync('pgrep -x Xvfb',{stdio:'ignore'}); }
      catch(e){ execSync('(Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &)',{shell:'/bin/bash'}); }
      await new Promise(r=>setTimeout(r,800));
      process.env.DISPLAY=':99';
      fsSync.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' xvfb: virtual screen active on :99\n');
    }catch(e){
      throw new Error('当前主机没有图形桌面，且未安装 Xvfb。请安装虚拟屏组件（Xvfb），或参考产品文档"虚拟屏"章节，或为容器配置桌面/VNC。');
    }
  }
  if(config.remote_cdp){
    const browser=await chromium.connectOverCDP(config.remote_cdp);
    context=browser.contexts()[0];
    page=context.pages()[0]||await context.newPage();
    process.env.DOUYIN_REMOTE='1';
    process.env.DOUYIN_CLICK_OFFSET_Y=String(clickOffsetY(config));
    process.env.DOUYIN_VM_SSH_KEY=String(config.vm_ssh_key||'');
    process.env.DOUYIN_VM_SSH_PORT=String(config.vm_ssh_port||'');
    process.env.DOUYIN_VM_SSH_USER=String(config.vm_ssh_user||'');
    process.env.DOUYIN_VM_SSH_HOST=String(config.vm_ssh_host||'');
  }else{
    const options={headless:!!config.headless,viewport:{width:800,height:600},acceptDownloads:true,args:["--disable-gpu","--disable-dev-shm-usage","--disable-extensions","--disable-background-networking","--disable-sync","--disable-translate","--no-first-run","--disable-features=TranslateUI","--mute-audio","--autoplay-policy=no-user-gesture-required"]};
    if(config.browser_channel)options.channel=config.browser_channel;
    if(config.browser_executable)options.executablePath=config.browser_executable;
    context=await chromium.launchPersistentContext(config.profile,options);
    page=context.pages()[0] || await context.newPage();
  }
  page.setDefaultTimeout(8000);
  await page.goto('https://www.douyin.com/',{waitUntil:'domcontentloaded',timeout:45000});
  if(config.restore_peer){
    try{
      await page.locator('[data-e2e="im-entry"]').waitFor({timeout:60000});
const imRect=await page.evaluate(()=>{const el=document.querySelector('[data-e2e="im-entry"]');const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
const {execSync}=await import('node:child_process');
const fs=await import('node:fs');
fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' im-entry found at '+imRect.x+','+imRect.y+'\n');
let panelOpened=false;
for(let imAttempt=1;imAttempt<=2&&!panelOpened;imAttempt++){
await page.waitForTimeout(imAttempt===1?2500:3500);
try{
execSync(xdoPrefix(!!config.remote_cdp)+'mousemove '+imRect.x+' '+(imRect.y+clickOffsetY(config))+' click 1'+xdoSuffix(!!config.remote_cdp));
fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' xdotool clicked (attempt '+imAttempt+')\n');
}catch(e){
fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' xdotool failed: '+e.message+'\n');
}
try{
await page.locator('[data-e2e="conversation-item"]').first().waitFor({timeout:45000});
panelOpened=true;
}catch(e){
fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' panel not open after attempt '+imAttempt+'\n');
}
}
if(!panelOpened)throw new Error('消息面板多次点击后仍未打开。');
fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' waiting for conversation-item list\n');      await page.locator('[data-e2e="conversation-item"]').first().waitFor({timeout:30000});
      fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' conversation-item appeared\n');
      const listed=await snapshot({conversations_only:true});
      const byID=config.restore_peer.conversation_id?(listed.conversations||[]).filter(
        item=>item.conversation_id===config.restore_peer.conversation_id):[];
      let match=byID.length===1;
      const dump=(listed.conversations||[]).slice(0,5).map(c=>(c.name||'?')+'#'+(c.conversation_id||'-')).join(' | ');
      fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' snapshot ok, conversations='+(listed.conversations||[]).length+' ['+dump+'] byID='+byID.length+'\n');
      fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' restore_peer expects: name='+(config.restore_peer.name||'?')+' id='+(config.restore_peer.conversation_id||'-')+' avatar='+(config.restore_peer.avatar||'-')+'\n');
      if(match){
        const {activateConversation}=await import('./conversation_ui.mjs');
        await activateConversation(page,byID[0],snapshot);
      }
      else match=await page.evaluate(peer=>{
        const clean=x=>{try{return new URL(x).pathname;}catch{return '';}};
        const candidates=[...document.querySelectorAll('[data-e2e="conversation-item"]')]
          .filter(x=>(!peer.avatar||[...x.querySelectorAll('img')].some(i=>clean(i.src)===clean(peer.avatar)))
            &&(peer.conversation_id||x.innerText.split('\n').map(t=>t.trim()).includes(peer.name)));
        if(candidates.length!==1)return false;
        candidates[0].setAttribute('data-mimi-restore-peer','true');return true;
      },config.restore_peer);
      fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' avatar/name match='+match+'\n');
      if(match){
        if(byID.length!==1){
          fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' restore: matched by avatar/name, clicking with xdotool\n');
          const peerRect=await page.evaluate(()=>{const el=document.querySelector('[data-mimi-restore-peer="true"]');if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();const ok=r.y>=0&&r.y+r.height<=600;return {x:r.x+r.width/2,y:r.y+r.height/2,ok};});
          if(peerRect&&peerRect.ok){
            try{
              execSync(xdoPrefix(!!config.remote_cdp)+'mousemove '+Math.round(peerRect.x)+' '+(Math.round(peerRect.y)+clickOffsetY(config))+' click 1'+xdoSuffix(!!config.remote_cdp));
              fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' restore: peer xdotool clicked at '+peerRect.x+','+peerRect.y+'\n');
            }catch(e){fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' restore: peer xdotool failed: '+e.message+'\n');}
          }else{
            fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' restore: peer element not found in DOM\n');
          }
        }
        await page.locator('.messageEditorinputArea').waitFor({timeout:30000});
        let restored;
        for(let i=0;i<6;i++){
          restored=await snapshot();
          if(restored.peer?.key===config.restore_peer.key)break;
          await page.waitForTimeout(500);
        }
        if(restored.peer?.key!==config.restore_peer.key)return {...await status(),state:'restore_recipient_mismatch'};
      }
    }catch(e){try{const fsmod=await import('node:fs');fsmod.appendFileSync('/tmp/worker_debug.log','restore FAILED: '+(e&&e.message||e)+'\n');}catch(_){}/* Keep login available for manual selection when restoring is unavailable. */}
  }
  return status();
}

async function saveIdentities() {
  if(!identities.dirty)return;
  await fs.writeFile(identityFile+'.tmp',JSON.stringify(Object.fromEntries(identities.known)),'utf8');
  await fs.rename(identityFile+'.tmp',identityFile);
  identities.dirty=false;
}

async function status() {
  if(!page || page.isClosed())return {open:false,logged_in:false,state:'browser_closed'};
  const cookies=await context.cookies('https://www.douyin.com');
  const session=cookies.some(x=>['sessionid','sessionid_ss'].includes(x.name)&&x.value);
  const ui=await page.evaluate(()=>({title:document.title,url:location.origin+location.pathname,
    editors:[...document.querySelectorAll('[contenteditable="true"],textarea')].filter(x=>x.getBoundingClientRect().width>20)
      .map(x=>({tag:x.tagName,className:x.className,role:x.getAttribute('role')})).slice(0,8),
    loginButton:[...document.querySelectorAll('button,[role="button"]')].some(x=>x.innerText?.trim()==='登录'&&x.getBoundingClientRect().width>10)}));
  return {open:true,logged_in:session&&!ui.loginButton,state:session?'waiting_for_conversation':'login_required',...ui};
}

async function snapshot(options={}) {
  if(!page || page.isClosed())throw new Error('请先打开浏览器，并登录机器人的抖音账号。');
  const domFile=path.join(path.dirname(fileURLToPath(import.meta.url)),'dom.mjs');
  const version=(await fs.stat(domFile)).mtimeMs;
  const {readChatDOM}=await import(pathToFileURL(domFile).href+'?v='+version);
  const data=await page.evaluate(readChatDOM,{debug:!!options.debug,conversations_only:!!options.conversations_only});
  // Resolve the open chat first: its header can supply a legacy profile link
  // missing from the list, and both must share the resolved key in this result.
  if(data.ready){
    const peer=data.peer;
    const group=peer.conversation_type==='group';
    if(group&&!peer.conversation_id)throw new Error('尚未取得稳定的群会话 ID，请打开群资料后重试绑定。');
    peer.key=identities.key(peer);
    identities.remember(peer,peer.key);
    peer.identity_kind=peer.conversation_id?'conversation_id':peer.link?'profile_link':'name_and_avatar';
    peer.link=publicURL(peer.link);peer.avatar=publicURL(peer.avatar);
  }
  for(const row of data.conversations||[]){
    row.key=row.conversation_id?identities.key(row):'';
    row.link=publicURL(row.link);row.avatar=publicURL(row.avatar);
  }
  await saveIdentities();
  if(!data.ready)return data;
  const group=data.peer.conversation_type==='group';
  const duplicates=new Map();
  for(const item of data.items) {
    if(group&&item.sender_id&&!/^\d+$/.test(item.sender_id))item.sender_id='dy-member-'+hash(item.sender_id).slice(0,24);
    // Never use the virtual-list index as the message identity: it shifts as new
    // messages arrive. Python aligns repeated content with the previous snapshot.
    item.fingerprint=hash(JSON.stringify([item.sender,item.text,item.links.map(publicURL),item.images.map(publicURL),item.kind,...(group?[item.sender_id]:[])]));
    const occurrence=duplicates.get(item.fingerprint)||0;duplicates.set(item.fingerprint,occurrence+1);
    item.key=item.native_id || item.fingerprint+':'+occurrence;
    item.images=item.images.map(src=>String(src||'')); // CHATIMGRAW: 保留完整URL（签名/data:），fingerprint 已单独归一化
  }
  return data;
}


// ===== VSESS_V1 视频会话注册表：同一作品的动作复用同一标签页，闲置 3 分钟回收 =====
const videoSessions=new Map();
let actionBusy=false; // ORPHANREAP_V1：动作执行期间暂停回收与收编，防止误收在用页面
const sessionKey=url=>{try{const u=new URL(url);return u.hostname+u.pathname.replace(/\/+$/,'');}catch{return null;}};
async function acquireVideoTab(url,opts){
  const key=sessionKey(url);
  if(key){
    const s=videoSessions.get(key);
    if(s&&!s.tab.isClosed()){
      s.lastUsed=Date.now();
      if(!(opts&&opts.noNavigate)){
        let samePath=false;
        try{const cur=new URL(s.tab.url());const want=new URL(url);
          samePath=cur.hostname===want.hostname&&cur.pathname.replace(/\/+$/,'')===want.pathname.replace(/\/+$/,'');}catch{}
        if(!samePath)await s.tab.goto(url,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
      }
      return {tab:s.tab,reused:true};
    }
    if(s)videoSessions.delete(key);
  }
  const tab=await openBackgroundPage(context,page); // VSESS_BG：后台开页，不抢聊天页前台
  return {tab,reused:false};
}
function registerVideoTab(url,tab){
  const key=sessionKey(url);
  if(!key)return;
  const old=videoSessions.get(key);
  if(old&&old.tab!==tab&&old.tab&&!old.tab.isClosed())old.tab.close().catch(()=>{});
  videoSessions.set(key,{tab,lastUsed:Date.now()});
}
function touchSession(url){
  const key=sessionKey(url);
  const s=key?videoSessions.get(key):null;
  if(s)s.lastUsed=Date.now();
}
setInterval(()=>{
  if(actionBusy)return; // ORPHANREAP_V1：动作执行中跳过，防止误收在用页面
  const now=Date.now();
  for(const [key,s] of [...videoSessions]){
    if(!s.tab||s.tab.isClosed()||now-s.lastUsed>180000){
      if(s.tab&&!s.tab.isClosed())s.tab.close().catch(()=>{});
      videoSessions.delete(key);
    }
  }
  if(context)import('./verify_state.mjs').then(verify=>{ // ORPHANREAP_V1：收编孤儿页，3分钟闲置后回收
    try{
      const registered=new Set([...videoSessions.values()].map(s=>s.tab));
      for(const p of context.pages()){
        if(!p||p===page)continue; // 聊天页永不回收
        if(registered.has(p))continue;
        const url=String((p.url&&typeof p.url==='function'&&p.url())||'');
        if(!url||url.indexOf('douyin.com')<0)continue;
        if(url.indexOf('/jingxuan')>=0)continue; // 聊天页兜底排除
        if(verify.isKept&&verify.isKept(p))continue; // 验证页保留
        registerVideoTab(url,p);
      }
    }catch{}
  }).catch(()=>{});
},30000).unref?.();
async function shareCard(args) { // SHARECARD_V1
const peer=String(args.peer||'').trim();
if(!peer)return {state:'error',reason:'缺少目标会话名 peer，未分享。'};
const {tab,reused}=await acquireVideoTab(args.url);
try{
await tab.bringToFront().catch(()=>{});
if(!reused)await tab.goto(args.url,{waitUntil:'domcontentloaded',timeout:45000});
await tab.waitForSelector('[data-e2e="video-share-container"],[data-e2e*="comment"]',{timeout:20000}).catch(()=>{});
await tab.waitForTimeout(5000);
await tab.waitForTimeout(2000); // SHARECARD_SCROLL2
const findIcon=()=>tab.evaluate(()=>{
const cands=[...document.querySelectorAll('[data-e2e="video-share-icon-container"]')]
.flatMap(c=>[c.querySelector('[data-popupid]'),c].filter(Boolean))
.concat([...document.querySelectorAll('[data-e2e="video-share-container"]')]);
const ok=r=>r&&r.width>=10&&r.height>=10;
for(const el of cands){
if(!ok(el.getBoundingClientRect()))continue;
try{el.scrollIntoView({block:'center'});}catch(e){}
const r2=el.getBoundingClientRect();
if(r2.top>=40&&r2.bottom<=window.innerHeight-20)
return {x:Math.round(r2.x+r2.width/2),y:Math.round(r2.y+r2.height/2)};
}
const el=cands.find(x=>ok(x.getBoundingClientRect()));
if(!el)return null;
try{el.scrollIntoView({block:'center'});}catch(e){}
const r=el.getBoundingClientRect();
return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
});
const iconPos=()=>tab.evaluate(()=>{
const cands=[...document.querySelectorAll('[data-e2e="video-share-icon-container"]')]
.flatMap(c=>[c.querySelector('[data-popupid]'),c].filter(Boolean))
.concat([...document.querySelectorAll('[data-e2e="video-share-container"]')]);
for(const el of cands){
const r=el.getBoundingClientRect();
if(r.width>=10&&r.height>=10&&r.top>=40&&r.bottom<=window.innerHeight-20)
return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
}
return null;
});
const icon=await findIcon();
if(!icon)return {state:'error',reason:'视频页未找到可见的分享图标，未分享。'};
const escaped=peer.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const detect=()=>tab.evaluate(re_src=>{
const re=new RegExp('^'+re_src+'(\\s|$)');
const vis=x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0;};
const searchBox=[...document.querySelectorAll('[placeholder]')].some(x=>vis(x)&&/搜索/.test(x.placeholder||''));
const rowCount=[...document.querySelectorAll('div,li')]
.filter(x=>vis(x)&&x.getBoundingClientRect().width>120&&x.getBoundingClientRect().height<150&&re.test((x.innerText||'').trim())).length;
return {searchBox,rowCount};
},escaped);
const hoverTo=async pt=>{await tab.mouse.move(pt.x,pt.y+250);await tab.mouse.move(pt.x,pt.y,{steps:12});};
await hoverTo(icon);
let opened=false;
for(let i=0;i<8;i++){
await tab.waitForTimeout(1000);
const d=await detect();
if(d.rowCount||d.searchBox){opened=true;break;}
if(i===3||i===6){const p=await iconPos();if(p)await hoverTo(p);}
}
if(!opened){
await tab.mouse.move(10,10);
await tab.waitForTimeout(800);
let c=await iconPos();
if(!c)c=await findIcon();
if(c)await hoverTo(c);
for(let i=0;i<6;i++){
await tab.waitForTimeout(1000);
const d=await detect();
if(d.rowCount||d.searchBox){opened=true;break;}
}
}
if(!opened){
const diag=await tab.evaluate(pt=>{
const vis=x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0;};
const iconEl=document.querySelector('[data-e2e="video-share-icon-container"]')||document.querySelector('[data-e2e="video-share-container"]');
const r=iconEl?iconEl.getBoundingClientRect():null;
const el=pt?document.elementFromPoint(pt.x,pt.y):null;
const portals=[...document.querySelectorAll('[class*="semi-portal"],[class*="popup"],[class*="popover"]')]
.filter(x=>vis(x)).map(x=>String(x.className).slice(0,50)+'::'+(x.innerText||'').replace(/\s+/g,'|').slice(0,50)).slice(0,4);
const guan=[...document.querySelectorAll('div,li')].filter(x=>vis(x)&&/罐头/.test(x.innerText||'')&&x.getBoundingClientRect().height<200)
.map(x=>(x.innerText||'').replace(/\s+/g,'|').slice(0,40)).slice(0,3);
return {iconRect:r?{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}:null,
atPoint:el?(el.tagName+'#'+String(el.className).slice(0,40)):null,
viewport:{w:window.innerWidth,h:window.innerHeight,scrollY:Math.round(window.scrollY)},
portals:portals,guan:guan,hasFocus:document.hasFocus()};
},icon);
return {state:'error',reason:'悬停分享图标后好友面板未出现，未分享。',diag:diag};
}
const clicked=await tab.evaluate(re_src=>{
const re=new RegExp('^'+re_src+'(\\s|$)');
const vis=x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0;};
const rows=[...document.querySelectorAll('div,li')]
.filter(x=>vis(x)&&x.getBoundingClientRect().width>120&&x.getBoundingClientRect().height<150&&re.test((x.innerText||'').trim()))
.sort((a,b)=>a.querySelectorAll('div').length-b.querySelectorAll('div').length);
for(const row of rows){
const btns=[...row.querySelectorAll('div,span,button')].filter(x=>vis(x)&&(x.textContent||'').trim()==='分享'&&x.children.length===0);
if(btns[0]){btns[0].click();return 'clicked';}
}
return rows.length?'no_button':'no_row';
},escaped);
if(clicked!=='clicked')return {state:'error',reason:'好友面板已打开但未能点击 '+peer+' 行的分享按钮('+clicked+')，未确认分享。'};
await tab.mouse.move(10,10);
await tab.waitForTimeout(1500);
return {state:'shared',reason:'已将视频以卡片形式分享给 '+peer+'。'};
} finally { await page.bringToFront().catch(()=>{}); touchSession(args.url); } // S3FRONT：分享后切回私信页
}
async function likePost(args) { // LIKEREAD_V1
  const {tab,reused}=await acquireVideoTab(args.url);
  try{
    if(!reused)await tab.goto(args.url,{waitUntil:'domcontentloaded',timeout:45000});
    await tab.waitForSelector('[data-e2e="video-share-container"],[data-e2e*="comment"]',{timeout:20000}).catch(()=>{});
    await tab.waitForTimeout(4000);
    const climb=()=>{
      let rail=document.querySelector('[data-e2e="video-share-container"]');
      for(let i=0;rail&&rail.parentElement&&i<8;i++){rail=rail.parentElement;if(rail.children.length>=4)break;}
      return (rail&&rail.children.length>=4)?rail:null;
    };
    const likedState=()=>{
      let rail=document.querySelector('[data-e2e="video-share-container"]');
      for(let i=0;rail&&rail.parentElement&&i<8;i++){rail=rail.parentElement;if(rail.children.length>=4)break;}
      if(!(rail&&rail.children.length>=4))rail=null; // LIKEFIX_V1 climb 内联
      if(!rail)return null;
      const like=rail.children[0];
      const others=new Set([rail.children[1],rail.children[2]].flatMap(c=>String(c.className).split(/\s+/)));
      return String(like.className).split(/\s+/).some(c=>c&&!others.has(c));
    };
    await tab.evaluate(()=>{const el=document.querySelector('[data-e2e="video-share-container"]')||document.querySelector('[data-e2e="video-detail"],[data-e2e="player-container"]');if(el)el.scrollIntoView({block:'center'});}); // LIKEFIX_V1 触发动作栏懒渲染
    await tab.waitForTimeout(1200);
    let liked=await tab.evaluate(likedState);
    if(liked===null)return {state:'error',reason:'视频页动作栏未就绪，未点赞。'};
    if(liked)return {state:'already_liked',reason:'该作品此前已点赞，未重复操作。'};
    await tab.evaluate(()=>{
      let rail=document.querySelector('[data-e2e="video-share-container"]');
      for(let i=0;rail&&rail.parentElement&&i<8;i++){rail=rail.parentElement;if(rail.children.length>=4)break;}
      rail.children[0].click();
    });
    await tab.waitForTimeout(2500);
    liked=await tab.evaluate(likedState);
    return liked?{state:'liked'}:{state:'unknown',reason:'点击后未确认点赞态变化，不声称已点赞。'};
  } finally { touchSession(args.url); }
}

async function readComments(args) { // LIKEREAD_V1
  const {tab,reused}=await acquireVideoTab(args.url);
  try{
    if(!reused)await tab.goto(args.url,{waitUntil:'domcontentloaded',timeout:45000});
    await tab.waitForSelector('[data-e2e="comment-list"]',{timeout:25000});
    await tab.waitForTimeout(2000);
    const limit=Math.max(1,Math.min(Number(args.limit||10),20));
    for(let i=0;i<3;i++){
      const count=await tab.evaluate(()=>{
        const list=document.querySelector('[data-e2e="comment-list"]');
        if(!list)return 0;
        list.lastElementChild&&list.lastElementChild.scrollIntoView({block:'end'});
        return list.children.length;
      });
      await tab.waitForTimeout(1500);
      if(count>=limit)break;
    }
    return await tab.evaluate(limit=>{
      const list=document.querySelector('[data-e2e="comment-list"]');
      if(!list)return {state:'error',reason:'评论区未加载。'};
      const comments=[...list.children].slice(0,limit).map(x=>({
        text:(x.innerText||'').replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim().slice(0,200)})).filter(x=>x.text);
      return {state:'read',comment_count:comments.length,comments};
    },limit);
  } finally { touchSession(args.url); }
}

async function searchPost(args) { // SEARCH_V1：按关键词搜索抖音视频，返回结果列表，观看交给 browse
  const query=String(args.query||'').trim().slice(0,60);
  if(!query)throw new Error('搜索关键词不能为空。');
  const verify=await import('./verify_state.mjs');
  const cd0=verify.cooldownRemaining();
  if(cd0>0)throw new Error('账号验证冷却中（约剩'+cd0+'分钟）：请先在 noVNC（http://192.168.1.162:6080 → vnc.html）完成验证；已解决可删除 /tmp/douyin_verify_lock.json 立即解除。');
  const searchUrl='https://www.douyin.com/search/'+encodeURIComponent(query)+'?type=video';
  const {tab,reused}=await acquireVideoTab(searchUrl);
  const pending=[];const posts=new Map();
  tab.on('response',response=>{
    if(!/\/aweme\/v1\/web\/search\//.test(response.url())||!(response.headers()['content-type']||'').includes('json'))return;
    pending.push(response.json().then(body=>{
      const items=[...(body.aweme_list||[]),...(body.data||[])];
      for(const item of items){
        const post=item&&item.aweme_info?item.aweme_info:item;
        const id=post&&(post.aweme_id||post.awemeId);
        if(/^\d{12,24}$/.test(String(id)))posts.set(String(id),post);
      }
    }).catch(()=>{}));
  });
  try{
    await tab.goto(searchUrl,{waitUntil:'domcontentloaded',timeout:45000}); // DUPGOTO_V1：搜索必须重新加载，复用旧页API无请求DOM兜底只剩1条旧链接
    try{fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' search 开始 query='+query+'\n')}catch{}
    if(await verify.detectVerify(tab)){verify.triggerCooldown(30);verify.keepOpen(tab);throw new Error('搜索页要求账号验证：页面已保留，请打开 noVNC（http://192.168.1.162:6080 → vnc.html）完成滑块；已进入约30分钟冷却，解除可删除 /tmp/douyin_verify_lock.json。');}
    for(let attempt=0;attempt<8&&posts.size<10;attempt++){
      await tab.waitForTimeout(500);
      await Promise.race([Promise.all(pending),new Promise(resolve=>setTimeout(resolve,2500))]);
    }
    if(posts.size===0){ // DOM 兜底：API 没抓到时从结果页链接抠
      await tab.waitForSelector('a[href*="/video/"],a[href*="/note/"]',{timeout:15000}).catch(()=>{});
      await tab.waitForTimeout(2000);
      const links=await tab.evaluate(()=>{
        const out=[];const seen=new Set();
        for(const a of document.querySelectorAll('a[href*="/video/"],a[href*="/note/"]')){
          const href=String(a.getAttribute('href')||'');
          const m=href.match(/\/(video|note)\/(\d{12,24})/);
          if(!m)continue;
          const id=m[2];
          if(seen.has(id))continue;seen.add(id);
          out.push({aweme_id:id,kind:m[1],desc:(a.innerText||'').replace(/\s+/g,' ').trim().slice(0,80)});
          if(out.length>=20)break;
        }
        return out;
      });
      for(const item of links)posts.set(item.aweme_id,item);
    }
    if(posts.size===0)return {state:'empty',reason:'搜索没有返回可解析的结果，请换个更具体的关键词。',query};
    const seen=new Set(args.seen_ids||[]);
    const results=[...posts.values()].map(post=>{
      const id=String(post.aweme_id||post.awemeId);
      const isNote=post.kind==='note'||post.note_card||post.aweme_type===68;
      return {post_id:id,url:'https://www.douyin.com/'+(isNote?'note':'video')+'/'+id,
        title:String(post.desc||'').slice(0,80),duration:Math.round(Number(post.duration||0)/1000)};
    }).filter(x=>x.post_id&&!seen.has(x.post_id)).slice(0,20);
    return {state:'ok',query,total:posts.size,results};
  } finally { touchSession(searchUrl); }
}

async function send(args) {
  return sendReply(page,snapshot,args);
}

async function selectConversation(args) {
  const list=await snapshot({conversations_only:true});
  const matches=(list.conversations||[]).filter(item=>args.conversation_id?
    item.conversation_id===args.conversation_id:item.name===args.name);
  if(matches.length!==1)throw new Error(matches.length?'存在同名会话，请使用会话 ID 选择。':'当前列表未找到指定会话，请先在抖音消息列表中打开它。');
  const {activateConversation}=await import('./conversation_ui.mjs');
  return activateConversation(page,matches[0],snapshot);
}

async function download(args) {
  const mediaFile=path.join(path.dirname(fileURLToPath(import.meta.url)),'media.mjs');
  const version=(await fs.stat(mediaFile)).mtimeMs;
  const {downloadVideo}=await import(pathToFileURL(mediaFile).href+'?v='+version);
  return downloadVideo(args,{context,page,settings,snapshot,siteHost,mediaHost,publicURL});
}

async function postInfo(args) {
  const {readPost}=await import('./post_media.mjs');
  return await readPost({...args,info_only:true,probe_comment:true},{context,page,settings,snapshot,siteHost,mediaHost,publicURL});
}

async function explore(action,args) {
  const {browsePost,publishComment}=await import('./explore.mjs');
  const environment={context,page,settings,snapshot,siteHost,mediaHost,publicURL,
  videoSession:{acquire:acquireVideoTab,register:registerVideoTab}};
  return await (action==='browse'?browsePost:publishComment)(args,environment);
}

const input=readline.createInterface({input:process.stdin});
let queue=Promise.resolve();
input.on('line',line=>{queue=queue.then(async()=>{
  let request;
  try {
    request=JSON.parse(line);
    const actions={open:()=>open(request.args),status,snapshot:()=>snapshot(request.args),conversations:()=>snapshot({conversations_only:true}),select_conversation:()=>selectConversation(request.args),send:()=>send(request.args),download:()=>download(request.args),post_info:()=>postInfo(request.args),
      browse:()=>explore('browse',request.args),comment:()=>explore('comment',request.args),like:()=>likePost(request.args),read_comments:()=>readComments(request.args),share_card:()=>shareCard(request.args),search:()=>searchPost(request.args),
      configure:async()=>{
        const limit=request.args.max_download_mb??settings.max_download_mb;
        const durationLimit=request.args.max_video_duration_seconds??settings.max_video_duration_seconds??180;
        if(!Number.isInteger(limit)||limit<1||limit>10000)throw new Error('作品下载大小上限应为 1～10000 MB。');
        if(!Number.isInteger(durationLimit)||durationLimit<0||durationLimit>10000)throw new Error('视频时长上限应为 0～10000 秒。');
        await fs.mkdir(request.args.media_dir,{recursive:true});
        settings.media_dir=request.args.media_dir;settings.max_download_mb=limit;settings.max_video_duration_seconds=durationLimit;
        return {media_dir:settings.media_dir,max_download_mb:settings.max_download_mb,max_video_duration_seconds:durationLimit};
      },
      close:async()=>{if(!(settings&&settings.remote_cdp))await context?.close();context=null;page=null;return {closed:true};}};
    if(!actions[request.action])throw new Error('未知浏览器操作。');
    const deadlineMs=170000;
let _timer=null;
const _guard=new Promise(resolve=>{_timer=setTimeout(()=>resolve(null),deadlineMs);});
const _task=Promise.resolve().then(()=>{actionBusy=true;return actions[request.action]();}).then(value=>({ok:true,value}),error=>({ok:false,error})).finally(()=>{actionBusy=false});
const _outcome=await Promise.race([_task,_guard]);
if(_timer)clearTimeout(_timer);
if(_outcome===null){
try{fs.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' 硬时限触发 action='+request.action+' id='+request.id+'，队列强制放行\n')}catch{}
throw new Error('浏览器操作超过170秒硬时限未完成，已强制放行。');
}
if(!_outcome.ok)throw _outcome.error;
const result=_outcome.value;
    process.stdout.write(JSON.stringify({id:request.id,ok:true,result})+'\n');
  } catch(error) {
    // Do not put signed media URLs, cookies, or page HTML in logs.
    const message=String(error.message||error).replace(/https?:\/\/\S+/g,'[URL]').slice(0,500);
    process.stdout.write(JSON.stringify({id:request?.id,ok:false,error:message})+'\n');
  }
});});
input.on('close',()=>{queue.finally(async()=>{if(!(settings&&settings.remote_cdp))await context?.close().catch(()=>{});process.exit(0);});});
