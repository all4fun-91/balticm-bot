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

func main() {
  port := os.Getenv("PORT")
  if port == "" { port = "10000" }
  password := os.Getenv("LAVALINK_PASSWORD")
  client := &http.Client{Timeout: 45 * time.Second}

  http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]any{
      "ok": true, "service": "BalticM Lavalink YouTube test proxy", "version": "1.0.0",
      "test": "/test?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    })
  })

  http.HandleFunc("/test", func(w http.ResponseWriter, r *http.Request) {
    target := r.URL.Query().Get("url")
    if target == "" { target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }

    endpoint := "http://127.0.0.1:2333/v4/loadtracks?identifier=" + url.QueryEscape(target)
    req, _ := http.NewRequest("GET", endpoint, nil)
    req.Header.Set("Authorization", password)
    resp, err := client.Do(req)
    w.Header().Set("Content-Type", "application/json")
    if err != nil {
      w.WriteHeader(502)
      json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
      return
    }
    defer resp.Body.Close()
    body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))

    var payload any
    if err := json.Unmarshal(body, &payload); err != nil {
      payload = string(body)
    }
    ok := resp.StatusCode >= 200 && resp.StatusCode < 300
    fmt.Printf("[TEST] Lavalink loadtracks status=%d target=%s\n", resp.StatusCode, target)
    w.WriteHeader(resp.StatusCode)
    json.NewEncoder(w).Encode(map[string]any{
      "ok": ok, "httpStatus": resp.StatusCode, "target": target, "lavalink": payload,
    })
  })

  fmt.Println("[BalticM] test proxy listening on :" + port)
  if err := http.ListenAndServe(":"+port, nil); err != nil { panic(err) }
}
