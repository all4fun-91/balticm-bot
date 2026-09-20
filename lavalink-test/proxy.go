package main

import (
  "encoding/json"
  "fmt"
  "io"
  "net/http"
  "net/url"
  "os"
  "time"
)

type node struct { Name, BaseURL, Password string }

func load(client *http.Client, n node, target string) map[string]any {
  endpoint := n.BaseURL + "/v4/loadtracks?identifier=" + url.QueryEscape(target)
  req, _ := http.NewRequest("GET", endpoint, nil)
  req.Header.Set("Authorization", n.Password)
  started := time.Now()
  resp, err := client.Do(req)
  if err != nil {
    return map[string]any{"node": n.Name, "ok": false, "error": err.Error(), "elapsedMs": time.Since(started).Milliseconds()}
  }
  defer resp.Body.Close()
  body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
  var payload any
  if err := json.Unmarshal(body, &payload); err != nil { payload = string(body) }
  loadType := ""
  if m, ok := payload.(map[string]any); ok {
    if s, ok := m["loadType"].(string); ok { loadType = s }
  }
  success := resp.StatusCode >= 200 && resp.StatusCode < 300 && loadType != "error" && loadType != "empty"
  return map[string]any{"node": n.Name, "ok": success, "httpStatus": resp.StatusCode, "loadType": loadType, "elapsedMs": time.Since(started).Milliseconds(), "lavalink": payload}
}

func main() {
  port := os.Getenv("PORT"); if port == "" { port = "10000" }
  localPassword := os.Getenv("LAVALINK_PASSWORD")
  client := &http.Client{Timeout: 45 * time.Second}

  http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]any{
      "ok": true, "service": "BalticM Lavalink test proxy", "version": "1.1.0",
      "localTest": "/test", "publicTest": "/test-public",
    })
  })

  http.HandleFunc("/test", func(w http.ResponseWriter, r *http.Request) {
    target := r.URL.Query().Get("url"); if target == "" { target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
    result := load(client, node{"Render local", "http://127.0.0.1:2333", localPassword}, target)
    w.Header().Set("Content-Type", "application/json"); json.NewEncoder(w).Encode(result)
  })

  http.HandleFunc("/test-public", func(w http.ResponseWriter, r *http.Request) {
    target := r.URL.Query().Get("url"); if target == "" { target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
    search := r.URL.Query().Get("search"); if search == "" { search = "ytsearch:Eminem Without Me" }
    n := node{"HeavenCloud public", "http://free-lava.heavencloud.in:4000", "heavencloud.in"}
    direct := load(client, n, target)
    searchResult := load(client, n, search)
    ok1, _ := direct["ok"].(bool); ok2, _ := searchResult["ok"].(bool)
    fmt.Printf("[PUBLIC TEST] direct=%v search=%v\n", ok1, ok2)
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]any{
      "ok": ok1 || ok2, "service": "BalticM external Lavalink test", "version": "1.1.0",
      "direct": direct, "search": searchResult,
    })
  })

  fmt.Println("[BalticM] test proxy listening on :" + port)
  if err := http.ListenAndServe(":"+port, nil); err != nil { panic(err) }
}
