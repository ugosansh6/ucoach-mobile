const fs=require('node:fs'),assert=require('node:assert/strict');
const utility=fs.readFileSync('src/utils/programCovers.js','utf8').replaceAll('export const ','const ').replaceAll('export function ','function ');
const {validProgramCover,MAX_PROGRAM_COVER_CHARS}=new Function(utility+';return {validProgramCover,MAX_PROGRAM_COVER_CHARS};')();
const source=fs.readFileSync('src/components/programs/ProgramPhotoPicker.web.js','utf8');
const from=source.indexOf('export async function compressProgramPhoto'),to=source.indexOf('export default function ProgramPhotoPicker');
assert.ok(from>=0&&to>from);
function harness({decodeFailure=false,dimensions=[1600,1200],canvasFailure=false,oversize=false}={}){
 const log={created:0,revoked:0,draws:[],qualities:[]};
 const URL={createObjectURL(){log.created++;return 'blob:qa'},revokeObjectURL(){log.revoked++}};
 const window={Image:class {constructor(){[this.naturalWidth,this.naturalHeight]=dimensions}set src(v){if(decodeFailure)this.onerror();else this.onload()}}};
 const canvas={width:0,height:0,getContext:()=>canvasFailure?null:{fillRect(){},drawImage(...args){log.draws.push(args.slice(1))}},toDataURL(type,q){log.qualities.push(q);return 'data:image/jpeg;base64,/9j/'+(oversize||q>0.65?'A'.repeat(MAX_PROGRAM_COVER_CHARS):'AA==')}};
 const document={createElement(tag){assert.equal(tag,'canvas');return canvas}};
 const compress=new Function('validProgramCover','URL','window','document',source.slice(from,to).replace('export async function','async function')+';return compressProgramPhoto;')(validProgramCover,URL,window,document);
 return {compress,log};
}
async function test(){
 const file={type:'image/png',size:12000};
 const h=harness();const cover=await h.compress(file);
 assert.equal(validProgramCover(cover),true);assert.deepEqual(h.log.qualities,[0.82,0.65]);assert.deepEqual(h.log.draws[0],[0,150,1600,900,0,0,960,540]);assert.equal(h.log.revoked,1);
 for(const opts of [{decodeFailure:true},{dimensions:[10000,10000]},{canvasFailure:true},{oversize:true}]){
  const h=harness(opts);await assert.rejects(()=>h.compress(file));assert.equal(h.log.revoked,1);
 }
 const invalid=harness();await assert.rejects(()=>invalid.compress({type:'image/svg+xml',size:1200}));await assert.rejects(()=>invalid.compress({type:'image/jpeg',size:21*1024*1024}));assert.equal(invalid.log.created,0);
 console.log('PASS cover compression control flow, crop geometry, limits, decode errors and temporary URL cleanup (browser primitives simulated)');
}
test().catch(e=>{console.error(e);process.exitCode=1;});
