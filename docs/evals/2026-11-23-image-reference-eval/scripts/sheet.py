import sys
from PIL import Image
out=sys.argv[1]; d=sys.argv[2]; names=sys.argv[3:]
H=320
ims=[]
for n in names:
    im=Image.open(f"{d}/{n}.png").convert('RGB'); w=int(im.width*H/im.height); ims.append(im.resize((w,H)))
W=Image.new('RGB',(sum(i.width for i in ims)+8*(len(ims)-1),H),'white'); x=0
for im in ims: W.paste(im,(x,0)); x+=im.width+8
W.save(out,quality=82)
