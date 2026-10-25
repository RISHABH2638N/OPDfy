// Test-only portability hook; no application or deployment configuration changes.
// All packaged integration suites create disposable replica sets; no URI input.
import {MongoInstance} from '../server/node_modules/mongodb-memory-server-core/lib/util/MongoInstance.js';
const original=MongoInstance.prototype.prepareCommandArgs;
MongoInstance.prototype.prepareCommandArgs=function(){const args=original.call(this);return args.includes('--nounixsocket')?args:[...args,'--nounixsocket'];};
