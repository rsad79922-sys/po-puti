// Sequential subprocesses keep SQLite ports and browser resources independent.
import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const browser=process.argv.includes('--browser');
const files=(await readdir('tests')).filter(name=>name.endsWith('.mjs')&&name.startsWith('browser-')===browser&&name!=='smoke-api.mjs').sort();
for(const name of files){
 console.log('TEST '+name);
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['tests/'+name],{stdio:'inherit'});
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error(name+' timed out'))},180000);
  child.once('error',error=>{clearTimeout(timer);reject(error)});
  child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(name+' failed: '+code))});
 });
}
console.log(`PASS: ${files.length} ${browser?'browser':'isolated'} suites`);
