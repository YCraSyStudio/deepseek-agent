/** Research fixture only. Never imported by the extension or used as a production fallback. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { performance } from 'node:perf_hooks';

const root = mkdtempSync(path.join(tmpdir(), 'ycrasy-sandbox-probe-'));
const project = path.join(root, 'project'); const reference = path.join(root, 'reference'); const outside = path.join(root, 'outside');
for (const directory of [project, reference, outside]) mkdirSync(directory);
writeFileSync(path.join(reference, 'read.txt'), 'reference'); writeFileSync(path.join(outside, 'secret.txt'), 'synthetic fixture only');
writeFileSync(path.join(project, '.env'), 'synthetic project secret');
writeFileSync(path.join(root, 'empty'), '');
writeFileSync(path.join(root, 'passwd'), `sandbox:x:${process.getuid()}:${process.getgid()}:Fixture:/home/sandbox:/bin/sh\n`);
writeFileSync(path.join(root, 'group'), `sandbox:x:${process.getgid()}:\n`);
symlinkSync(path.join(outside, 'secret.txt'), path.join(project, 'escape'));
const runtime = path.dirname(path.dirname(realpathSync(process.execPath)));
const report = { timestamp: new Date().toISOString(), platform: process.platform, versions: {}, measurements: [], tests: [], limitations: [] };
const server = net.createServer(socket => socket.end('fixture'));
await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
const port = server.address().port;
const base = ['--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL','--ro-bind','/usr','/usr',
  '--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64',
  '--ro-bind',runtime,'/runtime/node','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/home/sandbox',
  '--bind',project,'/project','--ro-bind',reference,'/reference','--ro-bind',path.join(root,'empty'),'/project/.env',
  '--ro-bind',path.join(root,'passwd'),'/etc/passwd','--ro-bind',path.join(root,'group'),'/etc/group',
  '--clearenv','--setenv','PATH','/runtime/node/bin:/usr/bin:/bin','--setenv','DOTNET_CLI_HOME','/tmp/dotnet',
  '--setenv','DOTNET_SKIP_FIRST_TIME_EXPERIENCE','1','--setenv','DOTNET_GENERATE_ASPNET_CERTIFICATE','false','--setenv','DOTNET_CLI_TELEMETRY_OPTOUT','1',
  '--setenv','npm_config_cache','/tmp/npm','--chdir','/project'];
function run(name, args, expect = 0, timeout = 20000) {
  const start = performance.now();
  const result = spawnSync('bwrap', [...base, ...args], { encoding: 'utf8', timeout, maxBuffer: 128 * 1024,
    env: { PATH: process.env.PATH, YCRASY_PROBE_SECRET: 'synthetic inherited secret' } });
  report.tests.push({ name, passed: result.status === expect, status: result.status, error: result.error?.code,
    durationMs: Math.round((performance.now()-start)*100)/100, stdout: result.stdout?.slice(-1500), stderr: result.stderr?.slice(-1500) });
  return result;
}
try {
  report.versions.bubblewrap = spawnSync('bwrap',['--version'],{encoding:'utf8'}).stdout?.trim();
  report.versions.node = process.version;
  report.versions.git = spawnSync('git',['--version'],{encoding:'utf8'}).stdout?.trim();
  report.versions.dotnet = spawnSync('dotnet',['--version'],{encoding:'utf8',timeout:5000}).stdout?.trim();
  report.binaryBytes = statSync('/usr/bin/bwrap').size;
  const start = run('sandbox starts', ['/bin/true']);
  if (start.status !== 0) {report.limitations.push('Namespace launch failed; no unsandboxed fallback was executed.');}
  else {
    run('allowed project write + reference read', ['node','-e', "const fs=require('fs');fs.writeFileSync('/project/allowed.txt','ok');if(fs.readFileSync('/reference/read.txt','utf8')!=='reference')process.exit(1)"]);
    run('out of scope read blocked', ['node','-e', `try{require('fs').readFileSync(${JSON.stringify(path.join(outside,'secret.txt'))});process.exit(1)}catch{}`]);
    run('out of scope write blocked', ['node','-e', `try{require('fs').writeFileSync(${JSON.stringify(path.join(outside,'write.txt'))},'bad');process.exit(1)}catch{}`]);
    run('reference write blocked', ['node','-e', "try{require('fs').writeFileSync('/reference/read.txt','bad');process.exit(1)}catch{}"]);
    run('symlink escape blocked', ['node','-e', "try{require('fs').readFileSync('/project/escape');process.exit(1)}catch{}"]);
    run('project sensitive file masked', ['node','-e', "if(require('fs').readFileSync('/project/.env','utf8')!=='')process.exit(1)"]);
    run('synthetic inherited environment secret removed', ['node','-e', "if(process.env.YCRASY_PROBE_SECRET)process.exit(1)"]);
    run('child inherits filesystem isolation', ['node','-e', "const r=require('child_process').spawnSync('node',['-e',\"try{require('fs').readFileSync('/project/escape');process.exit(1)}catch{}\"]);process.exit(r.status??1)"]);
    run('host loopback service inaccessible', ['node','-e', `const net=require('net');const s=net.connect({host:'127.0.0.1',port:${port}});s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(1),1000)`]);
    run('offline Git init/add/commit', ['/bin/sh','-c', "git init -q && git config user.name Fixture && git config user.email fixture@example.invalid && git add allowed.txt && git commit -qm fixture"]);
    writeFileSync(path.join(project,'package.json'), JSON.stringify({ name:'sandbox-fixture',version:'1.0.0',scripts:{test:'node -e "require(\'fs\').writeFileSync(\'/project/npm-test.txt\',\'ok\')"'} }));
    run('offline npm test', ['npm','test','--offline']);
    writeFileSync(path.join(project,'probe.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');
    writeFileSync(path.join(project,'Program.cs'), 'System.Console.WriteLine("sandbox fixture");');
    writeFileSync(path.join(project,'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>');
    run('offline dotnet restore/build', ['/bin/sh','-c', 'dotnet restore probe.csproj --configfile NuGet.Config -p:NuGetAudit=false && dotnet build probe.csproj --no-restore'],0,30000);
    const times=[];
    for(let i=0;i<20;i++){const t=performance.now();const r=spawnSync('bwrap',[...base,'/bin/true'],{encoding:'utf8',timeout:5000});if(r.status===0)times.push(performance.now()-t);}
    times.sort((a,b)=>a-b); report.measurements.push({ name:'20 empty launches',samples:times.length,medianMs:times[Math.floor(times.length/2)],p95Ms:times[Math.min(times.length-1,Math.floor(times.length*.95))] });
    const memory=spawnSync('/usr/bin/time',['-f','bwrap_maxRSS_kB=%M','bwrap',...base,'/usr/bin/time','-f','node_maxRSS_kB=%M','node','-e','0'],{encoding:'utf8',timeout:5000});
    report.measurements.push({name:'Empty command RSS (time accounting, not aggregate tree memory)',result:memory.stderr?.trim()});
    run('timeout exits instead of hanging', ['node','-e','setInterval(()=>{},1000)'],null,100);
    const childReport=report.tests.at(-1);childReport.passed=childReport.error==='ETIMEDOUT';
    report.limitations.push('Prototype isolates fixtures only; not integrated terminal/PTY, public network allowlisting, GUI sockets or production tool execution.', 'No Windows/macOS/WSL/remote host execution performed.', 'Dependency downloads and local server access require a separately reviewed network broker; offline test does not establish online compatibility.', 'Timeout fixture checks parent settlement only; descendant reaping and concurrent terminal reuse need production acceptance fixtures.');
  }
} finally {
  await new Promise(resolve=>server.close(resolve));
  rmSync(root,{recursive:true,force:true});
}
console.log(JSON.stringify(report,null,2));
if(report.tests.some(test=>!test.passed))process.exitCode=1;
