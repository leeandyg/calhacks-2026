// Reference: the current plain gray room, captured at 1920×1080.
// Logical canvas is an exact 1/4 scale. No shadows, outlines, furniture or extra UI.
// 22 sampled colors; planar light comes from upper left, never from a central glow.
pal({
  k:'#11171e', e:'#373b3e', u:'#677367', v:'#916635', w:'#a97e42',
  a:'#858886', g:'#7d8f75', b:'#92928a', c:'#809e95', f:'#919f81',
  d:'#a19c92', o:'#be9a5e', h:'#aba99e', i:'#9cb1aa', j:'#c2b186',
  l:'#b1b79c', s:'#bdbab1', m:'#a6bbb5', t:'#c8c1a5', n:'#d6c391',
  p:'#cfcdb6', q:'#e1d9c1'
})
ramps('audstq','ucim','vwonq','ugflpq')

// Four independently clipped glass panes. All streak motion is vertical in the
// wall's projected plane; the sill, frame and mullions are completely stationary.
const panes = [
  [189,88,197,84,197,103,189,107],
  [200,82,208,78,208,97,200,101],
  [189,110,197,106,197,125,189,129],
  [200,104,208,100,208,119,200,123]
]

scene('_shell', {w:480,h:270,bg:'k'},
  layer('floor',
    poly([123,181,240,239,240,245,123,187],'s'),
    poly([240,239,357,181,357,187,240,245],'a'),
    poly([123,181,240,123,357,181,240,239],'s')),
  layer('walls',
    poly([123,85,240,27,357,85,352,88,240,32,128,88],'s'),
    poly([123,85,128,88,128,184,123,187],'d'),
    poly([352,88,357,85,357,187,352,184],'a'),
    poly([128,88,240,32,240,128,128,184],'a'),
    poly([240,32,352,88,352,184,240,128],'d')),
  layer('window-frame',
    poly([186,86,209,75,210,76,187,87],'q'),
    poly([186,86,188,87,188,130,186,131],'j'),
    poly([188,87,210,76,210,119,188,130],'t'),
    ...panes.map((pane,index)=>poly(pane,index<2?'m':'c')),
    poly([197,84,199,83,199,124,197,125],'q'),
    poly([188,107,210,96,211,97,189,108],'q'),
    poly([189,108,211,97,211,99,189,110],'t'),
    poly([186,129,209,118,215,120,192,132],'q'),
    poly([192,132,215,120,215,122,192,134],'t'),
    poly([186,129,192,132,192,134,186,131],'j')),
  layer('bird-perch',
    poly([187,180,196,176,205,181,196,185],'o'),
    poly([187,180,196,185,196,187,187,182],'w'),
    poly([196,185,205,181,205,183,196,187],'v'),
    rect(194,163,3,17,'w'),vline(194,164,16,'o'),
    poly([183,159,206,170,206,172,183,161],'w'),
    poly([183,158,206,169,208,168,185,157],'o'),rect(193,162,2,3,'o')))

sprite('_bird-blue', {w:15,h:15},
  poly([1,6,6,2,11,4,11,7,7,9],'m'), rect(2,8,6,5,'i'),
  rect(7,7,4,5,'c'),rect(2,8,3,3,'c'),
  poly([6,2,10,0,14,2,10,4],'m'), rect(6,3,5,4,'i'),rect(11,3,3,4,'c'),
  rect(12,6,3,2,'o'),px(10,4,'e'),
  rect(0,9,2,3,'c'),rect(10,7,3,2,'c'),rect(2,11,9,2,'i'),rect(4,12,1,3,'w'),rect(8,12,1,3,'w'),hline(4,13,5,'w'))
sprite('_bird-gold', {base:'_bird-blue',flip:'x',swap:{m:'q',i:'n',c:'j',o:'w'}})

function bird(c, name, x, y, bob, blink) {
  c.stamp(name,x,y+bob)
  if(blink) c.hline(x+(name==='_bird-gold'?3:9),y+4+bob,2,'e')
}

// The guard can split a rotating blade into a lone low-contrast raster fragment.
// Join only those fragments to an adjacent rotor/guard cluster; retain eye glints.
function cleanFragments(c,cx,cy,halfX=11,halfY=11) {
  const offsets=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]
  const luminosity=v=>.2126*(v>>>24)+.7152*((v>>>16)&255)+.0722*((v>>>8)&255)
  for(let pass=0;pass<3;pass++) {
    const edits=[]
    for(let y=cy-halfY;y<=cy+halfY;y++) for(let x=cx-halfX;x<=cx+halfX;x++) {
      const key=c.key(x,y),neighbors=offsets.map(([dx,dy])=>c.key(x+dx,y+dy))
      if(neighbors.includes(key)) continue
      const contrast=Math.abs(luminosity(c.get(x,y))-offsets.reduce((sum,[dx,dy])=>sum+luminosity(c.get(x+dx,y+dy)),0)/8)
      if(contrast>=48) continue
      const counts={}
      neighbors.forEach(k=>counts[k]=(counts[k]||0)+1)
      const dominant=neighbors.reduce((a,b)=>counts[a]>=counts[b]?a:b)
      edits.push([x,y,dominant])
    }
    if(!edits.length) break
    edits.forEach(([x,y,key])=>c.px(x,y,key))
  }
}

function fan(c, phase) {
  // 3-fold rotor symmetry: exactly one blade pitch per loop, without a duplicate end frame.
  const angle=phase*Math.PI*2/3
  const wobble=Math.round(Math.sin(phase*Math.PI*2))
  const x=240, y=183
  c.rect(229+wobble,197,22,7,'p')
  c.rect(229+wobble,204,22,3,'l')
  c.rect(232+wobble,198,16,3,'t')
  c.poly([239,192,242,192,242+wobble,200,239+wobble,200],'f')
  c.circ(x,y,11,'f')
  c.circ(x,y,10,'u')
  for(let blade=0;blade<3;blade++) {
    const a=angle+blade*Math.PI*2/3
    const points=[0,0, 2,-4, 7,-7, 8,-3, 6,2, 2,3]
    const out=[]
    for(let p=0;p<points.length;p+=2) out.push(Math.round(x+points[p]*Math.cos(a)-points[p+1]*Math.sin(a)),Math.round(y+points[p]*Math.sin(a)+points[p+1]*Math.cos(a)))
    c.poly(out,'g')
  }
  c.ring(x,y,11,'p')
  c.ring(x,y,9,'l')
  // Fixed safety grille is redrawn identically above each rotor patch.
  for(let spoke=0;spoke<8;spoke++) {
    const a=spoke*Math.PI/4
    c.line(x,y,Math.round(x+Math.cos(a)*10),Math.round(y+Math.sin(a)*10),'l')
  }
  c.circ(x,y,2,'p')
  c.hline(x-1,y-1,2,'q')
  cleanFragments(c,x,y)
}

function rain(c, frameIndex) {
  panes.forEach((pane,index)=>{
    const left=pane[0], top=Math.min(pane[1],pane[3]), bottom=Math.max(pane[5],pane[7])
    for(let stream=0;stream<2;stream++) {
      const x=left+2+stream*3
      const y=top+((frameIndex+stream*8+index*5)%16)
      // A wrap copy enters as the previous streak leaves the pane.
      for(const offset of [-16,0,16]) {
        const streak=[]
        for(let dy=0;dy<3;dy++) {
          const yy=y+offset+dy
          if(yy>=top && yy<=bottom) {
            // Slope-aware point-in-pane test, including a one-pixel frame clearance.
            const upper=pane[1]-(x-left)*0.5
            const lower=pane[7]-(x-left)*0.5
            if(yy>upper+1 && yy<lower-1) streak.push(yy)
          }
        }
        // Never leave a detached 1px droplet at the clipping boundary.
        if(streak.length>=2) streak.forEach(yy=>c.px(x,yy,'p'))
      }
    }
  })
}

// All frames patch the exact same immutable, static shell. Only these three
// bounded regions can change: glass, the fan, and the two birds.
const dynamic=(c,index)=>{
  const phase=index/16
  rain(c,index)
  bird(c,'_bird-blue',184,150,Math.round(Math.sin(phase*Math.PI*2)),index===3)
  bird(c,'_bird-gold',196,155,Math.round(Math.sin((phase+5/16)*Math.PI*2)),index===11)
  cleanFragments(c,197,160,16,13)
  fan(c,phase)
}
sprite('room-base',{w:480,h:270},stamp('_shell',0,0),c=>dynamic(c,0))
anim('room-loop',{w:480,h:270,fps:10,loop:true,base:'_shell'},
  ...Array.from({length:16},(_,index)=>frame(c=>dynamic(c,index))))
sheet('room-frames',['room-loop'],{cols:4,pad:0})
