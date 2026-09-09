// Run from worker/ with an ignored local .dev.vars or process environment.
// Does not deploy, mutate Lark, print credentials, or print command/output text.
import {createCommandSimplifier} from '../src/modules/ai/command-simplifier-service.js';
const command='补螺栓+补说明书\n入库前在同型号的三四类找说明书补上，若没有需告知，重分二类M8LS-14-BS\nFD-B044-260908-0001';
const env={OPENAI_API_KEY:process.env.OPENAI_API_KEY,OPENAI_COMMAND_MODEL:process.env.OPENAI_COMMAND_MODEL,OPENAI_COMMAND_DIAGNOSTICS:'true'};
const result=await createCommandSimplifier(env,{onDiagnostic:diagnostic=>console.log(JSON.stringify({route:'ai-command-local-test',...diagnostic}))}).simplify(command);
console.log(JSON.stringify({commandAiStatus:result.commandAiStatus,commandAiSource:result.commandAiSource,rawPreservedOnFallback:result.commandAiSource==='RAW_FALLBACK'?result.commandDisplay===command:null}));
process.exitCode=result.commandAiSource==='AI'?0:1;
