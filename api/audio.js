const { put, del, get } = require('@vercel/blob');
const { Readable } = require('stream');

function readRaw(req){
  return new Promise((resolve,reject)=>{
    const chunks=[]; let size=0;
    req.on('data',c=>{
      size+=c.length;
      if(size>4*1024*1024){ reject(new Error('FILE_TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end',()=>resolve(Buffer.concat(chunks)));
    req.on('error',reject);
  });
}
function safe(s){return String(s||'audio').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,120)}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    if(req.method==='POST'){
      const type=String(req.headers['content-type']||'application/octet-stream').split(';')[0];
      const name=decodeURIComponent(req.headers['x-file-name']||'audio');
      const key=decodeURIComponent(req.headers['x-audio-key']||'audio');
      const ext=(name.split('.').pop()||'').toLowerCase();

      if(!['mp3','m4a','wav'].includes(ext)){
        return res.status(415).json({error:'MP3, M4A, WAV only'});
      }

      const body=await readRaw(req);
      if(!body.length) return res.status(400).json({error:'Empty file'});

      const pathname=`railway-audio/${safe(key)}-${Date.now()}.${ext}`;

      // This project uses a PRIVATE Vercel Blob store.
      const blob=await put(pathname,body,{
        access:'private',
        contentType:type,
        addRandomSuffix:false
      });

      return res.status(200).json({
        ok:true,
        url:blob.url,
        pathname:blob.pathname
      });
    }

    if(req.method==='GET'){
      const pathname=String(req.query?.pathname||'');
      if(!pathname.startsWith('railway-audio/')){
        return res.status(400).json({error:'Invalid pathname'});
      }

      const result=await get(pathname,{
        access:'private',
        useCache:true
      });

      if(!result) return res.status(404).json({error:'Audio not found'});

      const type=String(req.query?.type||'audio/mpeg');
      res.statusCode=result.statusCode||200;
      res.setHeader('Content-Type',type);
      res.setHeader('Cache-Control','private, max-age=3600');

      if(result.stream){
        // @vercel/blob returns a Web ReadableStream.
        Readable.fromWeb(result.stream).pipe(res);
        return;
      }
      return res.status(500).json({error:'No audio stream'});
    }

    if(req.method==='DELETE'){
      const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
      const target=body?.pathname || body?.url;
      if(target) await del(target);
      return res.status(200).json({ok:true});
    }

    res.setHeader('Allow','GET, POST, DELETE');
    return res.status(405).json({error:'Method not allowed'});
  }catch(e){
    if(e.message==='FILE_TOO_LARGE'){
      return res.status(413).json({error:'File too large',message:'音声ファイルは1つ4MB未満にしてください。'});
    }
    return res.status(500).json({error:'Audio API error',message:e.message});
  }
};

module.exports.config={api:{bodyParser:false}};
