from bs4 import BeautifulSoup
import json
from pathlib import Path
root=Path(__file__).parent
s=BeautifulSoup((root/'site/index.html').read_text(encoding='utf8'),'html.parser')
sections=[]
for section in s.select('main section[id]'):
    name=section.find('h2').get_text(' ',strip=True)
    lead=section.select_one('.section-lead')
    items=[]
    entries=section.select('.resume-entry')
    if not entries:
        items=[{'title':name,'date':'','meta':'','status':'','paragraphs':[p.get_text(' ',strip=True) for p in section.find_all('p')], 'links':[{'label':a.get_text(' ',strip=True),'url':a.get('href')} for a in section.select('a[href]')]}]
    else:
        for e in entries:
            h=e.select_one('.entry-top h3') or e.find('h3')
            items.append({'title':h.get_text(' ',strip=True) if h else 'Untitled', 'date':e.select_one('.entry-date').get_text(' ',strip=True) if e.select_one('.entry-date') else '', 'meta':e.select_one('.entry-meta').get_text(' ',strip=True) if e.select_one('.entry-meta') else '', 'status':e.select_one('.resume-status').get_text(' ',strip=True) if e.select_one('.resume-status') else '', 'paragraphs':[p.get_text(' ',strip=True) for p in e.select('p')], 'links':[{'label':a.get_text(' ',strip=True),'url':a.get('href')} for a in e.select('a[href]')]})
    sections.append({'id':section['id'],'name':name,'lead':lead.get_text(' ',strip=True) if lead else '', 'items':items})
output='/* Snapshot fallback; the game attempts to reread index.html whenever it loads. */\nwindow.RC_RESUME_SNAPSHOT = '+json.dumps(sections,ensure_ascii=False,separators=(',',':'))+';\n'
(root/'site/rc-resume-data.js').write_text(output,encoding='utf8')
print('Sections:',len(sections),'Entries:',sum(map(lambda x:len(x['items']),sections)),'JS bytes:',len(output.encode()))
