import assert from 'node:assert/strict';
import test from 'node:test';
import {signPayload} from '../oauth-session.js';
import {buildAuthorizationUrl, createStreamingOAuthState, validateStreamingOAuthState, exchangeAuthorizationCode, refreshAccessToken, getAuthenticatedAccount, normalizeOAuthAccount, publicStreamingAccount, streamingOAuthSetupReport} from '../streaming-oauth.js';
import {checkProviderLive, autoStreamerRowsForGuilds} from '../streamers.js';
import worker from '../worker.js';

test('retired YouTube OAuth cannot request authorization or use existing tokens', async()=>{
 const options={env:{GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret'},state:'state',code:'code',accessToken:'access',refreshToken:'refresh',httpFetch:async()=>{assert.fail('No Google requests are allowed');}};
 assert.equal(buildAuthorizationUrl('youtube',options).ok,false);
 for(const fn of [exchangeAuthorizationCode,refreshAccessToken,getAuthenticatedAccount])assert.equal((await fn('youtube',options)).ok,false);
 assert.equal((await createStreamingOAuthState({secret:'secret',provider:'youtube',discordUserId:'123'})).ok,false);
 const legacy=await signPayload({v:2,k:'streaming',n:'nonce',u:'123',p:'youtube',exp:Date.now()+60000},'secret');
 assert.equal((await validateStreamingOAuthState(legacy,{secret:'secret'})).ok,false);
 assert.equal(normalizeOAuthAccount('youtube',{id:'channel'}).ok,false);
 assert.equal(publicStreamingAccount({provider:'youtube',verified:1}),null);
 assert.equal('youtube' in streamingOAuthSetupReport(),false);
 assert.equal((await checkProviderLive('youtube',{}, {YOUTUBE_API_KEY:'key'},options.httpFetch)).status,'unknown');
 assert.deepEqual(autoStreamerRowsForGuilds({accounts:[{provider:'youtube',discordUserId:'123',verified:true}],guilds:[{id:'guild',premium:true,memberIds:['123']}]}),[]);
});

test('retired YouTube routes cannot redirect to Google',async()=>{
 for(const path of ['connect','callback']){
  const response=await worker.fetch(new Request('https://bot.balticm.eu/api/profile/streaming/youtube/'+path),{});
  assert.equal(response.headers.get('location'),null);
  assert.ok(response.status>=400);
 }
});
