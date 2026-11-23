source "$(dirname "$0")/lib.sh"
M=gpt-image-2.5-flare
W=$(cat "$(dirname "$0")/wrap.txt")
w() { printf "$W" "$1"; }
U1='A bold poster for our spring sale that says SPRING SALE 30% OFF in big letters, with spring flowers around it.'
U2='یک پوستر شاد برای حراج بهاره با نوشته‌ی بزرگ «حراج بهاره ۳۰٪ تخفیف» و گل‌های بهاری دورش'
U3='Our bakery storefront in the morning, with the shop name "Golden Crust" painted on the sign above the door.'
U4='A chalkboard menu in our cafe listing today'"'"'s specials and prices.'
U5='A laptop on a desk showing our analytics dashboard with revenue charts and big numbers.'
gen C0_raw_sale $M 1024x1024 "$U1" &
gen C1_sale  $M 1024x1024 "$(w "$U1")" &
gen C1_sale_b $M 1024x1024 "$(w "$U1")" &
gen C2_fa    $M 1024x1024 "$(w "$U2")" &
gen C2_fa_b  $M 1024x1024 "$(w "$U2")" &
gen C3_sign  $M 1024x1024 "$(w "$U3")" &
gen C3_sign_b $M 1024x1024 "$(w "$U3")" &
gen C4_menu  $M 1024x1024 "$(w "$U4")" &
gen C4_menu_b $M 1024x1024 "$(w "$U4")" &
gen C5_screen $M 1024x1024 "$(w "$U5")" &
gen C5_screen_b $M 1024x1024 "$(w "$U5")" &
gen C0_raw_fa $M 1024x1024 "$U2" &
wait
