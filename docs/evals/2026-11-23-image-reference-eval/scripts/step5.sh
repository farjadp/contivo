D="$(dirname "$0")"; source "$D/lib.sh"; export K TM=gpt-4.1-mini
M=gpt-image-2.5-flare
W=$(cat "$D/wrap.txt")
U1='A bold poster for our spring sale that says SPRING SALE 30% OFF in big letters, with spring flowers around it.'
U2='یک پوستر شاد برای حراج بهاره با نوشته‌ی بزرگ «حراج بهاره ۳۰٪ تخفیف» و گل‌های بهاری دورش'
U3='Our bakery storefront in the morning, with the shop name "Golden Crust" painted on the sign above the door.'
U4='A chalkboard menu in our cafe listing today'"'"'s specials and prices.'
U5='A laptop on a desk showing our analytics dashboard with revenue charts and big numbers.'
U6='A portrait of our CEO in the style of Wes Anderson, holding a Starbucks cup.'
i=0
for U in "$U1" "$U2" "$U3" "$U4" "$U5" "$U6"; do i=$((i+1))
  S=$(python3 -I "$D/sanitize.py" "$U"); echo "S$i $S" | tee -a "$D/raw/sanitized.txt"
  P=$(python3 -I -c 'import json,sys;print(json.loads(sys.argv[1]).get("prompt",""))' "$S")
  [ -n "$P" ] && { gen S${i}_a $M 1024x1024 "$(printf "$W" "$P")" & gen S${i}_b $M 1024x1024 "$(printf "$W" "$P")" & }
done
wait
