package main

import (
  "encoding/json"
  "fmt"
  "io"
  "net/http"
  "net/url"
  "os"
  "sync"
  "time"
)

type node struct { Name, BaseURL, Password string }

func load(client *http.Client, n node, target string) map[string]any {
  endpoint := n.BaseURL + "/v4/loadtracks?identifier=" + url.QueryEscape(target)
  req, _ := http.NewRequest("GET", endpoint, nil)
  req.Header.Set("Authorization", n.Password)
  started := time.Now()
  resp, err := client.Do(req)
  if err != nil { return map[string]any{"node":n.Name,"ok":false,"error":err.Error(),"elapsedMs":time.Since(started).Milliseconds()} }
  defer resp.Body.Close()
  body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
  var payload any
  if err := json.Unmarshal(body,&payload); err != nil { payload=string(body) }
  loadType := ""
  if m,ok:=payload.(map[string]any); ok { if s,ok:=m["loadType"].(string); ok { loadType=s } }
  success := resp.StatusCode>=200 && resp.StatusCode<300 && loadType!="error" && loadType!="empty"
  return map[string]any{"node":n.Name,"ok":success,"httpStatus":resp.StatusCode,"loadType":loadType,"elapsedMs":time.Since(started).Milliseconds(),"lavalink":payload}
}

func main(){
  port:=os.Getenv("PORT"); if port=="" { port="10000" }
  localPassword:=os.Getenv("LAVALINK_PASSWORD")
  client:=&http.Client{Timeout:20*time.Second}

  http.HandleFunc("/",func(w http.ResponseWriter,r *http.Request){
    w.Header().Set("Content-Type","application/json")
    json.NewEncoder(w).Encode(map[string]any{"ok":true,"service":"BalticM Lavalink test proxy","version":"1.2.0","localTest":"/test","publicTest":"/test-public"})
  })

  http.HandleFunc("/test",func(w http.ResponseWriter,r *http.Request){
    target:=r.URL.Query().Get("url"); if target=="" { target="https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
    json.NewEncoder(w).Encode(load(client,node{"Render local","http://127.0.0.1:2333",localPassword},target))
  })

  http.HandleFunc("/test-public",func(w http.ResponseWriter,r *http.Request){
    target:=r.URL.Query().Get("url"); if target=="" { target="https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
    search:=r.URL.Query().Get("search"); if search=="" { search="ytsearch:Eminem Without Me" }
    nodes:=[]node{
      {"Serenetia","https://lavalinkv4.serenetia.com","https://seretia.link/discord"},
      {"Jirayu","https://lavalink.jirayu.net","youshallnotpass"},
      {"MilloHost","https://lava-v4.millohost.my.id","https://discord.gg/mjS5J2K3ep"},
      {"TriniumHost","https://lavalink-v4.triniumhost.com","free"},
    }
    type pair struct{ Name string; Direct,Search map[string]any; OK bool }
    out:=make([]pair,len(nodes)); var wg sync.WaitGroup
    for i,n:=range nodes { wg.Add(1); go func(i int,n node){ defer wg.Done(); d:=load(client,n,target); s:=load(client,n,search); od,_:=d["ok"].(bool); os,_:=s["ok"].(bool); out[i]=pair{n.Name,d,s,od||os} }(i,n) }
    wg.Wait()
    winners:=[]string{}; results:=[]map[string]any{}
    for _,p:=range out { if p.OK { winners=append(winners,p.Name) }; results=append(results,map[string]any{"node":p.Name,"ok":p.OK,"direct":p.Direct,"search":p.Search}) }
    fmt.Printf("[PUBLIC TEST] winners=%v\n",winners)
    w.Header().Set("Content-Type","application/json")
    json.NewEncoder(w).Encode(map[string]any{"ok":len(winners)>0,"service":"BalticM HTTPS Lavalink matrix","version":"1.2.0","workingNodes":winners,"results":results})
  })

  fmt.Println("[BalticM] test proxy listening on :"+port)
  if err:=http.ListenAndServe(":"+port,nil); err!=nil { panic(err) }
}
