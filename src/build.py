# Builds ../index.html from template.html + core.js + ui.js. Run: python3 src/build.py
import os
d=os.path.dirname(os.path.abspath(__file__))
t=open(d+'/template.html').read()
t=t.replace('/*CORE*/',open(d+'/core.js').read()).replace('/*UI*/',open(d+'/ui.js').read())
open(d+'/../index.html','w').write(t)
