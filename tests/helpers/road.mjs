import http from 'node:http';
import {once} from 'node:events';
// Test-owned route provider: deterministic fixture, never a public service.
export async function roadFixture(duration=7200){const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({code:'Ok',routes:[{distance:180000,duration}]}))});server.listen(0,'127.0.0.1');await once(server,'listening');return {env:{ROUTING_PROVIDER:'osrm',ROUTING_URL:'http://127.0.0.1:'+server.address().port},stop:async()=>{server.close();await once(server,'close')}}}
