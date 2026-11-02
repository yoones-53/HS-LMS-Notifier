import {readFileSync,existsSync,readdirSync,statSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {extractFile,listPackage} from '@electron/asar';
import {credentialsConfigured,readCredentials,CREDENTIAL_TARGET,DISCORD_TARGET,CALENDAR_TARGET} from '../src/auth/credentials.js';
import {resolveRuntimePaths} from '../src/runtime/paths.js';
import {assertSafeDiagnostics} from '../src/utils/security.js';
import {PROJECT_ROOT} from '../src/utils/config.js';

assertSafeDiagnostics();
const output=join(PROJECT_ROOT,'outputs');mkdirSync(output,{recursive:true});
const secrets:Array<{category:string;bytes:Buffer[]}>=[];
for(const [category,target] of [['LMS',CREDENTIAL_TARGET],['DISCORD',DISCORD_TARGET],['GOOGLE',CALENDAR_TARGET]]){
  if(!await credentialsConfigured(target))continue;
  const value=await readCredentials(target);
  for(const [field,text] of Object.entries(value))if(text.length>=8&&(field==='password'||category==='LMS'))secrets.push({category:`${category}_${field}`,bytes:[Buffer.from(text),Buffer.from(text,'utf16le'),Buffer.from(text).toString('base64')].map(v=>typeof v==='string'?Buffer.from(v):v)});
  value.id='';value.password='';
}
const matches=(data:Buffer)=>secrets.filter(secret=>secret.bytes.some(bytes=>data.includes(bytes))).map(secret=>secret.category);
try{
  const artifacts=[];
  const artifactPaths:Array<[string,string]>=[['preview',resolve('release/win-unpacked/resources/app.asar')]];
  if(process.env.HS_LMS_REVIEW_INSTALLED_ASAR)artifactPaths.unshift(['running',resolve(process.env.HS_LMS_REVIEW_INSTALLED_ASAR)]);
  for(const [label,path] of artifactPaths){
    const bytes=readFileSync(path);const pkg=JSON.parse(extractFile(path,'package.json').toString());const files=listPackage(path,{isPack:false});
    const forbidden=files.filter(file=>/(?:^|\/)(?:\.env(?:\.[^/]*)?|lms\.sqlite(?:-wal|-shm)?|settings\.json|latest-run\.json|fixture-main\.mjs|storage-state[^/]*\.json|cookies\.json)$/.test(file.replaceAll('\\','/')));
    artifacts.push({label,version:pkg.version,knownCredentialMatches:matches(bytes),forbiddenFileCount:forbidden.length,
      developerAbsolutePathPresent:bytes.includes(Buffer.from(process.cwd()))});bytes.fill(0);
  }
  const runtime=resolveRuntimePaths();const runtimeFiles=[resolve('.env'),join(runtime.state,'settings.json'),runtime.database,`${runtime.database}-wal`,
    ...existsSync(runtime.logs)?readdirSync(runtime.logs).filter(name=>/\.(jsonl|json|log)$/.test(name)).map(name=>join(runtime.logs,name)):[]];
  const runtimeFindings=[];let runtimeScanned=0;
  for(const file of runtimeFiles)if(existsSync(file)&&statSync(file).size<=100000000){const bytes=readFileSync(file);const hits=matches(bytes);runtimeScanned++;if(hits.length)runtimeFindings.push({kind:file===resolve('.env')?'LOCAL_ENV':file===runtime.database?'DATABASE':file.includes('settings.json')?'SETTINGS':'LOG',categories:hits});bytes.fill(0);}
  const listed=execFileSync('git',['rev-list','--objects','--all'],{encoding:'utf8',maxBuffer:8000000}).trim().split('\n').map(line=>line.split(' ')[0]!).filter(Boolean);
  const types=spawnSync('git',['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],{input:listed.join('\n')+'\n',encoding:'utf8',maxBuffer:8000000});
  const blobs=types.stdout.trim().split('\n').map(line=>line.split(' ')).filter(parts=>parts[1]==='blob'&&Number(parts[2])<3000000).map(parts=>parts[0]);
  const batch=spawnSync('git',['cat-file','--batch'],{input:blobs.join('\n')+'\n',maxBuffer:100000000});
  const history=Buffer.from(batch.stdout);let offset=0,blobsScanned=0,webhookBlobs=0;const historyHits:Record<string,number>={};
  while(offset<history.length){const end=history.indexOf(10,offset);if(end<0)break;const header=history.subarray(offset,end).toString().split(' '),size=Number(header[2]);if(!Number.isFinite(size))break;
    const data=history.subarray(end+1,end+1+size);blobsScanned++;for(const hit of matches(data))historyHits[hit]=(historyHits[hit]??0)+1;
    if(/https:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/\d{15,22}\/[A-Za-z0-9_-]{40,}/.test(data.toString('utf8')))webhookBlobs++;
    offset=end+1+size+1;
  }
  history.fill(0);
  const result={checkedAt:new Date().toISOString(),artifacts,runtimeScanned,runtimeFindings,history:{blobsScanned,currentCredentialMatchesByCategory:historyHits,realLookingDiscordWebhookBlobs:webhookBlobs},
    limitation:'Known current credential matching and limited file/history scan; not proof that no past or unknown personal information exists.'};
  writeFileSync(join(output,'개인정보-배포파일-점검.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{for(const secret of secrets)for(const bytes of secret.bytes)bytes.fill(0);}
