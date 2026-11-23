import sys,json,urllib.request,os
K=os.environ['K']; model=os.environ['TM']
SYS=("You turn a brand owner's image request into a picture description for an image model. "
"Rules: (1) Keep the subject, setting, mood, colours and composition. (2) Remove every piece of text the user wants shown: quoted words, slogans, names, prices, percentages, numbers, menus, labels, captions, logos, screen contents. Do not repeat any of those words, in any language. "
"(3) Any surface that would carry text (poster, sign, menu board, label, screen, packaging) is described as blank, plain-coloured, out of focus or turned away; a poster becomes a decorative composition with a large empty plain area where a caption could later be placed. "
"(4) Remove named artists, brands, trademarks, characters and real people; describe the look in plain words instead. "
"(5) If the request is unsafe, return {\"refused\":true}. Write in English, under 70 words. Return JSON: {\"refused\":false,\"prompt\":\"...\",\"removed\":[\"what you removed\"]}")
req=sys.argv[1]
body={"model":model,"response_format":{"type":"json_object"},"messages":[{"role":"system","content":SYS},{"role":"user","content":req}]}
r=urllib.request.Request("https://api.openai.com/v1/chat/completions",data=json.dumps(body).encode(),headers={"Authorization":"Bearer "+K,"Content-Type":"application/json"})
j=json.load(urllib.request.urlopen(r,timeout=60))
out=json.loads(j['choices'][0]['message']['content'])
u=j['usage']; open(os.path.dirname(os.path.abspath(__file__))+'/raw/sanitize_usage.jsonl','a').write(json.dumps({'model':j['model'],'in':u['prompt_tokens'],'out':u['completion_tokens']})+"\n")
print(json.dumps(out,ensure_ascii=False))
