import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openBackgroundPage} from './browser_actions.mjs';
import {getCommentEditor,getCommentSubmit,captureEmptyCommentControls} from './comment_ui.mjs';

export function videoDurationDecision(duration, maxSeconds=180) {
  const limit=Number(maxSeconds);
  if(!Number.isInteger(limit)||limit<0||limit>10000)throw new Error('视频时长上限应为 0～10000 秒。');
  if(limit===0)return null;
  const known=Number.isFinite(duration)&&duration>0;
  if(known&&duration<=limit)return null;
  const reason=known?'duration_limit':'duration_unknown';
  const message=known
    ?`这条视频时长约 ${Math.ceil(duration)} 秒，超过当前 ${limit} 秒上限，已跳过下载，未观看。请换一个不超过上限的新视频。`
    :`这条视频暂时无法确认时长，当前上限为 ${limit} 秒，已跳过下载，未观看。请换一个能确认时长的新视频。`;
  return {state:'skipped',reason,downloaded:false,verified:false,
    duration:known?duration:null,max_duration_seconds:limit,retry_action:'choose_another_video',message};
}

export function postImageCandidates(detail) {
  const images=Array.isArray(detail?.images)&&detail.images.length?detail.images:detail?.image_post_info?.images;
  if(!Array.isArray(images))return [];
  return images.map(image=>{
    const lists=[image.display_image?.url_list,image.owner_watermark_image?.url_list,image.url_list,image.download_url_list];
    return [...new Set(lists.flatMap(list=>Array.isArray(list)?list:[]).filter(url=>typeof url==='string'&&url.startsWith('https:')))].slice(0,3);
  });
}

export function postImages(detail) {
  return postImageCandidates(detail).map(candidates=>candidates[0]);
}

async function downloadViaVM(url,{page,settings,mediaHost},expected,remaining,allowTruncate=false){ // RANGEDOWN_V1
  try{fsSync.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' VM下载开始 '+new URL(String(url)).hostname+'\n')}catch{}
  const target=new URL(String(url));
  if(target.protocol!=='https:'||!mediaHost(target.hostname))throw new Error('媒体下载地址不在支持范围。');
  const {spawn}=await import('node:child_process');
  const {createWriteStream}=await import('node:fs');
  const shq=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
  const ua=await page.evaluate(()=>navigator.userAgent);
  const sshArgs=['-i',(process.env.DOUYIN_VM_SSH_KEY||'/root/.ssh/douyin_vm'),'-p',String(process.env.DOUYIN_VM_SSH_PORT||'2222'),'-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3',(process.env.DOUYIN_VM_SSH_USER||'root')+'@'+(process.env.DOUYIN_VM_SSH_HOST||'127.0.0.1')];
  let remoteFile='/tmp/douyin_dm_'+randomUUID().slice(0,8)+'.bin';
  const run=args=>new Promise((resolve,reject)=>{
    const p=spawn('ssh',[...sshArgs,...args]);
    let out='',err='';
    p.stdout.on('data',d=>{out+=d;});
    p.stderr.on('data',d=>{err+=d;});
    p.on('error',reject);
    p.on('close',code=>code===0?resolve(out):reject(new Error('VM命令失败(exit '+code+'):'+err.trim().slice(0,300))));
  });
  if(!allowTruncate&&expected==='video'){ // SIZEPRE_V1：下载前预检总大小，超预算短片不再白等全量下载
    try{
      const probe=await run(["curl -sS -m 15 -r 0-0 -D - -o /dev/null -w 'PROBE:%{http_code}' -H 'Referer: https://www.douyin.com/' -A "+shq(ua)+" -- "+shq(String(url))+"; true"]);
      const ptxt=String(probe);
      const pcode=Number((ptxt.match(/PROBE:(\d+)/)||[])[1]||0);
      const crange=Number((ptxt.match(/content-range:\s*bytes\s+\d+-\d+\/(\d+)/i)||[])[1]||0);
      const clen=Number((ptxt.match(/content-length:\s*(\d+)/i)||[])[1]||0);
      const total=pcode===206?crange:(pcode===200?clen:0);
      try{fsSync.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' 预检 code='+pcode+' total='+total+' remaining='+remaining+'\n')}catch{}
      if(total>0&&total>remaining){
        console.error('[downloadViaVM] 预检命中 total='+total+' > remaining='+remaining);
        throw new Error('作品媒体总大小超过下载设置(预检)。');
      }
    }catch(e){
      if(String((e&&e.message)||e).indexOf('预检')>=0)throw e; // 命中放行上层换条；探测技术失败静默走原路径
    }
  }
  let meta='';
  try{
    meta=await run(["find /tmp -maxdepth 1 -name 'douyin_dm_*.bin' -mmin +360 -delete 2>/dev/null; curl -sSL -m 300"+(allowTruncate?" -r 0-"+String(Math.max(1,remaining-1)):"")+" -H 'Referer: https://www.douyin.com/' -A "+shq(ua)
      +' -o '+shq(remoteFile)+" -w 'META:%{http_code}:%{content_type}' -- "+shq(String(url))
      +" && stat -c SIZE:%s "+shq(remoteFile)]);
  }catch(e){throw new Error('VM侧下载失败:'+e.message);}
  const status=(String(meta).match(/META:(\d+):(\S*)/)||[])[1]||'0';
  const mime=(((String(meta).match(/META:(\d+):(\S*)/)||[])[2])||'').split(';')[0];
  let size=Number((String(meta).match(/SIZE:(\d+)/)||[])[1]||0); // CONSTFIX_V1：VMSKIP_B压缩后要重新赋值
  try{fsSync.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' 下载诊断 status='+status+' size='+size+' meta='+String(meta)+'\n')}catch{}
    console.error('[downloadViaVM] status='+status+' mime='+mime+' size='+size+' host='+target.hostname);
  if((status!=='200'&&status!=='206')||!mime.startsWith(expected+'/'))throw new Error('VM下载返回异常:status='+status+' mime='+mime);
  if(size>remaining)throw new Error('作品媒体总大小超过下载设置。');
  if(expected==='video'&&size>Math.min(Number(settings.max_model_video_mb)||18,14)*1024*1024){ // VMSKIP_B：VM侧压缩，云服务器零转码
    const modelFile=remoteFile+'.model.mp4';
    const tOpt=allowTruncate?(' -t '+(settings.max_video_duration_seconds||180)+' '):' '; // TSPACE_V1 空tOpt保分隔空格，否则'file'-vf粘连成不存在路径
    let comp='';
    try{
      comp=await run(["ffmpeg -hide_banner -loglevel error -i "+shq(remoteFile)+tOpt+"-vf scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2 -c:v libx264 -crf 32 -preset veryfast -c:a aac -b:a 48k -movflags +faststart -y "+shq(modelFile)+" && stat -c SIZE:%s "+shq(modelFile)+" && rm -f "+shq(remoteFile)]);
    }catch(e){try{fsSync.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' VM压缩失败err '+String((e&&e.message)||e).slice(0,300)+'\n')}catch{}/* VM压缩失败走云服务器原路径兜底 */}
    const csize=Number((String(comp).match(/SIZE:(\d+)/)||[])[1]||0);
    if(csize>0){
      try{fsSync.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' VM压缩完成 orig='+size+' model='+csize+'\n')}catch{}
      remoteFile=modelFile; size=csize;
    }
  }
  await fs.mkdir(settings.media_dir,{recursive:true});
  const extension=expected==='video'?'.mp4':({'image/png':'.png','image/webp':'.webp','image/avif':'.avif','image/gif':'.gif'}[mime]||'.jpg');
  const file=path.join(settings.media_dir,randomUUID()+extension);
  const p=spawn('ssh',[...sshArgs,'cat '+shq(remoteFile)]);
  const ws=createWriteStream(file);
  const exited=new Promise(res=>p.on('close',res));
  const timer=setTimeout(()=>{try{p.kill();}catch(_){}},240000);
  let bytes=0,serr='';
  p.stdout.on('data',d=>{bytes+=d.length;});
  p.stderr.on('data',d=>{serr+=d;});
  await new Promise((resolve,reject)=>{
    p.stdout.on('error',reject);ws.on('error',reject);
    ws.on('finish',resolve);
    p.stdout.pipe(ws);
  });
  await exited;
  clearTimeout(timer);
  if(p.exitCode!==0)throw new Error('视频回传失败(exit '+p.exitCode+'):'+serr.trim().slice(0,200));
  if(bytes!==size)throw new Error('回传字节数不符('+bytes+'/'+size+')');
  await fs.writeFile(file+'.vmpath',remoteFile,'utf8').catch(()=>{});
  return {path:file,bytes,mime,vm_path:remoteFile};
}
async function downloadAsset(url,{context,page,settings,mediaHost},expected,remaining,allowTruncate=false) {
  if(process.env.DOUYIN_REMOTE==='1')return await downloadViaVM(url,{page,settings,mediaHost},expected,remaining,allowTruncate);
  let response;
  for(let redirects=0;redirects<5;redirects++) {
    const target=new URL(url);
    if(target.protocol!=='https:'||!mediaHost(target.hostname)||target.username||target.password)
      throw new Error('媒体下载地址不在支持范围。');
    const cookies=await context.cookies(url);
    try{
      response=await fetch(url,{redirect:'manual',headers:{Referer:'https://www.douyin.com/',
        'User-Agent':await page.evaluate(()=>navigator.userAgent),Cookie:cookies.map(cookie=>cookie.name+'='+cookie.value).join('; ')},
        signal:AbortSignal.timeout(60000)});
    }catch(e){
      const host=new URL(url).hostname;
      const cause=e&&e.cause?String(e.cause.code||e.cause.message||e.cause):'none';
      const detail=(e&&e.message)?e.message:String(e);
      console.error('[downloadAsset] fetch failed: '+detail+' | cause='+cause+' | host='+host);
      throw new Error('媒体下载请求失败:'+detail+'; cause='+cause+'; host='+host);
    }
    if(response.status>=300&&response.status<400){url=new URL(response.headers.get('location'),url).href;continue;}
    break;
  }
  const mime=(response?.headers.get('content-type')||'').split(';')[0];
  if(!response?.ok||!mime.startsWith(expected+'/'))throw new Error('实际媒体文件下载失败。');
  if(Number(response.headers.get('content-length'))>remaining)throw new Error('作品媒体总大小超过下载设置。');
  const reader=response.body.getReader();const chunks=[];let bytes=0;
  try {
    while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;
      if(bytes>remaining)throw new Error('作品媒体总大小超过下载设置。');chunks.push(chunk.value);}
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  const extension=expected==='video'?'.mp4':({'image/png':'.png','image/webp':'.webp','image/avif':'.avif','image/gif':'.gif'}[mime]||'.jpg');
  await fs.mkdir(settings.media_dir,{recursive:true});
  const file=path.join(settings.media_dir,randomUUID()+extension);
  await fs.writeFile(file,Buffer.concat(chunks));
  return {path:file,bytes,mime};
}

export async function readPost(args,environment) {
  const {context,page,settings,siteHost,mediaHost,publicURL}=environment;
  const verify=await import('./verify_state.mjs');
  const cd=verify.cooldownRemaining();
  if(cd>0)throw new Error('账号验证冷却中（约剩'+cd+'分钟）：请先在 noVNC（http://192.168.1.162:6080 → vnc.html）完成验证；已解决可删除 /tmp/douyin_verify_lock.json 立即解除。');
  try{fsSync.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' readPost 开始 '+url.pathname.slice(-22)+'\n')}catch{}
  const url=new URL(args.url);
  if(url.protocol!=='https:'||!siteHost(url.hostname)||url.username||url.password)throw new Error('作品来源不受支持。');
  const tab=(args.tab&&!args.tab.isClosed())?args.tab:(environment.videoSession?await environment.videoSession.acquire(args.url,{noNavigate:true}).then(r=>r.tab):await openBackgroundPage(context,page));
  const media=[];
  const detailPromise=tab.waitForResponse(response=>/\/aweme\/v1\/web\/aweme\/detail\//.test(response.url())
    && response.status()===200 && (response.headers()['content-type']||'').includes('json'),{timeout:18000})
    .then(response=>response.json()).catch(()=>null);
  tab.on('response',response=>{
    if((response.headers()['content-type']||'').startsWith('video/')&&mediaHost(new URL(response.url()).hostname))media.push(response.url());
  });
  let readPostOK=false; // VSESS_V1
  try {
    await tab.goto(url.href,{waitUntil:'commit',timeout:45000});
    if(await tab.evaluate(()=>/视频不存在|作品不存在|无法查看|内容不可见|作品已删除/.test(document.body.innerText)).catch(()=>false))throw new Error('作品不存在或不可见（可能已删除或受限），请换一条：再次调用并将 url 留空选择新的推荐作品。');
    if(await verify.detectVerify(tab)){verify.triggerCooldown(30);verify.keepOpen(tab);throw new Error('抖音要求账号验证：页面已保留，请打开 noVNC（http://192.168.1.162:6080 → vnc.html）完成滑块；已进入约30分钟冷却，解除可删除 /tmp/douyin_verify_lock.json。');}
    const payload=await detailPromise;
    const detail=payload?.aweme_detail;
    const id=new URL(tab.url()).pathname.match(/\/(?:video|note)\/(\d+)/)?.[1]
      ||url.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1];
    if(detail && id && String(detail.aweme_id)!==id)throw new Error('作品详情标识不匹配，未读取其他内容。');
    const imageCandidates=postImageCandidates(detail);
    const images=imageCandidates.map(candidates=>candidates[0]);
    const postID=String(detail?.aweme_id||id||'');
    const info={kind:images.length?'images':'video',description:String(detail?.desc||''),
      source:postID?`https://www.douyin.com/${images.length?'note':'video'}/${postID}`:publicURL(tab.url()),post_id:postID,image_count:images.length,
      has_video:!!detail?.video,metadata_fields:detail?Object.keys(detail):[]};
    if(args.info_only) {
      await tab.waitForSelector('video,[data-e2e*="comment"]',{timeout:10000}).catch(()=>{});
      await tab.waitForTimeout(1000);
      if(args.probe_comment) {
        let editor;
        try {
          editor=await getCommentEditor(tab);
          if(args.probe_text){await editor.focus();await editor.press('Control+A');await editor.press('Backspace');await captureEmptyCommentControls(tab);await tab.keyboard.insertText('临时检查，未发送');await tab.waitForTimeout(300);}
          const submit=await getCommentSubmit(tab);
          info.comment_ui={editor_count:await editor.count(),submit_count:await submit.count(),submitted:false};
        } catch(error) {info.comment_ui={ready:false,reason:String(error.message),submitted:false};}
        finally {
          if(args.probe_text)info.comment_ui.scene=await tab.evaluate(()=>{
            const inner=document.querySelector('.comment-input-inner-container');
            const parent=inner?.parentElement?.parentElement;
            if(!parent)return [];
            return [...parent.querySelectorAll('button,div,span,svg,use')].slice(-45).map(node=>({tag:node.tagName,
              cls:node.getAttribute('class'),label:node.getAttribute('aria-label'),title:node.getAttribute('title'),
              role:node.getAttribute('role'),href:node.getAttribute('href')||node.getAttribute('xlink:href'),
              text:node.tagName.toLowerCase()==='svg'?'':(node.innerText||'').slice(0,35),
              handlers:Object.keys(node).filter(key=>key.startsWith('__reactProps')).flatMap(key=>Object.keys(node[key]||{}).filter(name=>name.startsWith('on')))}));
          });
          if(args.probe_text&&editor){await editor.focus();await editor.press('Control+A');await editor.press('Backspace');await tab.waitForTimeout(300);
            info.comment_ui.draft_cleared=(await editor.innerText()).replace(/[\u200b\ufeff]/g,'').trim()==='';}
        }
      }
      info.comment_permission={allow_comment:detail?.status?.allow_comment,video_allow_comment:detail?.video_control?.allow_comment};
      info.comment_controls=await tab.evaluate(()=>{
        const visible=node=>node.getBoundingClientRect().width>10&&node.getBoundingClientRect().height>8;
        const describe=node=>({tag:node.tagName,cls:String(node.className),e2e:node.getAttribute('data-e2e'),
          editable:node.getAttribute('contenteditable'),role:node.getAttribute('role'),visible:visible(node),
          placeholder:node.getAttribute('placeholder')||node.getAttribute('data-placeholder'),
          text:(node.tagName==='BUTTON'||node.getAttribute('role')==='button')?(node.innerText||'').slice(0,40):''});
        return {editors:[...document.querySelectorAll('textarea,input,[contenteditable]')].map(describe).slice(0,25),
          e2e:[...new Set([...document.querySelectorAll('[data-e2e]')].map(node=>node.getAttribute('data-e2e')))].slice(0,70),
          inputs:[...document.querySelectorAll('[class*="comment-input"],[class*="CommentInput"],[class*="commentInput"],[data-placeholder],[data-slate-editor]')].map(describe).slice(0,20),
          composer:[...document.querySelectorAll('.commentInput-right-ct')].map(node=>({parent_class:String(node.parentElement.className),parent_text:node.parentElement.innerText.slice(0,180),
            children:[...node.parentElement.querySelectorAll('div,span,button')].slice(-16).map(child=>({tag:child.tagName,cls:String(child.className),text:child.innerText.slice(0,30)}))})),
          iframes:[...document.querySelectorAll('iframe')].map(node=>({title:node.title,path:(()=>{try{return new URL(node.src).pathname;}catch{return '';}})()})).slice(0,8),
          buttons:[...document.querySelectorAll('button,[role="button"],[data-e2e*="comment"]')].filter(visible)
            .filter(node=>/comment|评论|发送|发布/.test(String(node.className)+' '+node.getAttribute('data-e2e')+' '+node.innerText)).map(describe).slice(0,25)};
      });
      return info;
    }
    let remaining=(settings.max_download_mb||64)*1024*1024;
    if(images.length) {
      if(images.length>Number(settings.max_post_images||30))throw new Error('图文图片数量超过设置，未仅下载封面。');
      if(imageCandidates.some(candidates=>!candidates.length))throw new Error('图文中有原图地址缺失，未把部分图片当作完整作品。');
      const files=[];
      try {
        for(const candidates of imageCandidates){
          let image;
          let lastError;
          for(const candidate of candidates){
            try { image=await downloadAsset(candidate,environment,'image',Math.min(remaining,20*1024*1024)); break; }
            catch(error) { lastError=error; }
          }
          if(!image)throw new Error('图文第 '+(files.length+1)+' 张图片下载失败：'+(lastError?.message||'没有可用候选地址'));
          files.push(image);remaining-=image.bytes;
        }
        readPostOK=true;
        return {...info,images:files,bytes:files.reduce((sum,image)=>sum+image.bytes,0)};
      } catch(error) {
        await Promise.all(files.map(file=>fs.rm(file.path,{force:true}).catch(()=>{})));
        throw error;
      }
    }
    if(!detail?.video && /\/note\//.test(tab.url()))throw new Error('图文详情没有返回原图，未用封面代替。');
    try{
      const _pv=await tab.waitForFunction(()=>{const ok=[...document.querySelectorAll('video')].some(video=>video.currentSrc&&video.readyState>=1);if(ok)return 'ready';if(/视频不存在|作品不存在|无法查看|内容不可见|作品已删除/.test(document.body.innerText))return 'missing';return false;},undefined,{timeout:45000}).then(handle=>handle.jsonValue());
    try{fsSync.appendFileSync('/tmp/worker_debug.log',new Date().toISOString().slice(11,23)+' 视频等待结果='+String(_pv)+'\n')}catch{}
    if(_pv==='missing')throw new Error('作品不存在或不可见（可能已删除或受限），将自动换下一条。');
    }catch(e){
      try{
        const state=await tab.evaluate(()=>({url:location.href,title:document.title,videos:[...document.querySelectorAll('video')].map(v=>({rs:v.readyState,w:Math.round(v.getBoundingClientRect().width),src:(v.currentSrc||'').slice(0,90)})),body:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,300)}));
        const fsmod=await import('node:fs');
        fsmod.appendFileSync('/tmp/worker_debug.log','watch-tab timeout, state: '+JSON.stringify(state)+'\n');
      }catch(_){}
      throw e;
    }
    let probe=null; // PROBERETRY_V1：视频元素可能在就绪后因虚拟列表重渲染短暂消失，重试等待
    for(let i=0;i<6&&!probe;i++){
      probe=await tab.evaluate(()=>{
        const video=[...document.querySelectorAll('video')].filter(item=>item.currentSrc&&item.readyState>=1)
          .sort((a,b)=>b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height)[0];
        return video?{url:video.currentSrc,duration:video.duration,title:document.title}:null;
      });
      if(!probe)await tab.waitForTimeout(1500);
    }
    if(!probe)throw new Error('视频元素就绪后又消失，未取得视频地址，请重试或换一条。');
    const skipped=videoDurationDecision(probe.duration,settings.max_video_duration_seconds??180);
    const truncWatch=!!args.allow_truncate&&!!skipped&&skipped.reason==='duration_limit'; // TRUNCWATCH_V1 搜索链路截断看长视频
    if(skipped&&!truncWatch)return {...info,...skipped,title:probe.title};
    await tab.waitForTimeout(1200);
    const playURL=detail?.video?.play_addr?.url_list?.find(value=>value.startsWith('https:'));
    const assetURL=playURL||(probe.url.startsWith('https:')?probe.url:media.at(-1));
    if(!assetURL)throw new Error('没有取得实际视频文件。');
    const file=await downloadAsset(assetURL,environment,'video',remaining,truncWatch||!!args.share_mode); // DURSHARE_V2 分享链超大小也range截断 // DUPRANGE_V1 只有真正超时长的才range截断，短片全量下载避免时长校验误杀
    readPostOK=true;
    return {...info,...file,duration:Number.isFinite(probe.duration)?probe.duration:null,truncated:truncWatch,title:probe.title,
      download_strategy:playURL?'detail_play_addr':'player_source',media_response_count:media.length};
  } finally {
    if(verify.isKept(tab)){}
    else if(environment.videoSession&&readPostOK){
      environment.videoSession.register(args.url,tab); // VSESS_V1：保留页面供后续动作复用
    }
    else {
    let delay=0;
      try{const state=await tab.evaluate(()=>{const e=document.querySelector('video');return e?{duration:e.duration||0,paused:e.paused,ended:e.ended}:null;});
        if(state&&state.duration>0&&!state.ended)delay=Math.min(180000,Math.max(15000,Math.round(state.duration*1000*(0.7+Math.random()*0.4))))+3000+Math.floor(Math.random()*8000);}catch{}
      if(delay>0){console.error('[readPost] 观看模拟 '+(delay/1000|0)+'s 后关闭标签页');setTimeout(()=>{tab.close().catch(()=>{});},delay);}
      else await tab.close();
    }
  }
}
