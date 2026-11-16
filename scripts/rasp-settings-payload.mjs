// stdout is piped straight into SSH stdin, never logged or stored as an artifact.
import {raspPayload} from '../deploy/install-rasp-settings.mjs';
try{process.stdout.write(JSON.stringify(raspPayload(process.env)))}catch{console.error('RASP_PAYLOAD_FAILED: missing key or unsafe settings');process.exitCode=1}
