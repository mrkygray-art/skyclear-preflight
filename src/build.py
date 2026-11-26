# Builds ../index.html from template.html + airports_nasr.js (generated) + core.js + ui.js. Run: python3 src/build.py
import os
d=os.path.dirname(os.path.abspath(__file__))
t=open(d+'/template.html',encoding='utf-8').read()
t=t.replace('/*CORE*/',open(d+'/airports_nasr.js',encoding='utf-8').read()+open(d+'/core.js',encoding='utf-8').read()).replace('/*UI*/',open(d+'/ui.js',encoding='utf-8').read())
open(d+'/../index.html','w',encoding='utf-8').write(t)
