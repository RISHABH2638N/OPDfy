import mongoose from 'mongoose';
const uri=process.env.OPDFY_TEST_DB_URI||'';
if(process.env.NODE_ENV!=='test'||!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri))throw new Error('Worker requires an explicit loopback test database.');
await mongoose.connect(uri,{dbName:'opdfy_production_hardening',autoIndex:false});
const {createApplication}=await import('../../src/app.js');
const app=createApplication({realtime:{distributed:true}});
app.server.listen(0,'127.0.0.1',()=>process.send?.({port:app.server.address().port}));
process.once('message',async message=>{
 if(message==='close'){await new Promise(resolve=>app.io.close(resolve));await mongoose.disconnect();process.exit(0);}
});
