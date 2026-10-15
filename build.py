import json, re, hashlib, base64, os
css=open("base.css").read()
head=open("head.html").read().replace("__BASECSS__", css)
script=open("script.js").read().replace("__SAMPLE_INV__", json.dumps(open("invoices.csv").read())).replace("__SAMPLE_BANK__", json.dumps(open("bank.csv").read()))
out=head+open("body.html").read()+"<script>"+script+"</script>\n</body>\n</html>\n"
h=base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode()
csp=("default-src 'none'; script-src 'sha256-"+h+"'; style-src 'unsafe-inline' https://fonts.googleapis.com; "
     "font-src https://fonts.gstatic.com; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'")
out=out.replace("__CSP__", '<meta http-equiv="Content-Security-Policy" content="'+csp+'">')
os.makedirs("out",exist_ok=True); open("out/index.html","w").write(out); print(len(out))
