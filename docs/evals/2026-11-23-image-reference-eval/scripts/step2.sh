source "$(dirname "$0")/lib.sh"
M=gpt-image-2.5-flare; R=raw
RA="$R/refA1.png $R/refA2.png $R/refA3.png $R/refA4.png"; RB="$R/refB1.png $R/refB2.png $R/refB3.png"
STY='Match the visual style of the reference images exactly: the same medium, colour palette, texture, lighting and composition habits. Do not copy their subjects. No text, letters, numbers or logos anywhere.'
P1='A dentist chair in a small, bright dental clinic treatment room.'
P2='A real-estate agent handing a set of house keys to a young couple at the front door of a house.'
# A: style from references
gen  A_ctrl_dentist $M 1024x1024 "$P1 No text, letters, numbers or logos anywhere." &
edit A_refA_dentist $M 1024x1024 - "Create a new image: $P1 $STY" $RA &
edit A_refA_keys    $M 1024x1024 - "Create a new image: $P2 $STY" $RA &
edit A_refB_dentist $M 1024x1024 - "Create a new image: $P1 $STY" $RB &
edit A_refB_keys    $M 1024x1024 - "Create a new image: $P2 $STY" $RB &
edit A_refA_keys_26 gpt-image-2.6-flare 1024x1024 - "Create a new image: $P2 $STY" $RA &
wait
# B: product photo
KEEP='Keep the bottle exactly as it is in the photo: same shape and proportions, same brushed steel cap, the NORDA wordmark unchanged, exactly three thin orange rings at the base. Do not redraw or restyle the bottle. Add no other text, letters or logos.'
edit B_desk_high $M 1536x1024 high "Place this exact bottle standing on a wooden desk in a sunlit office, next to a closed laptop and a notebook, landscape cover photo. $KEEP" $R/prod1.png &
edit B_desk_low  $M 1536x1024 low  "Place this exact bottle standing on a wooden desk in a sunlit office, next to a closed laptop and a notebook, landscape cover photo. $KEEP" $R/prod1.png &
edit B_bg_high   $M 1024x1536 high "Replace only the background with a soft warm peach-to-cream gradient and a soft contact shadow. Portrait framing with more space above the bottle. $KEEP" $R/prod1.png &
edit B_brand_high $M 1024x1024 high "Photograph the bottle from the first image in the visual style of the other images (backdrop colours, hard sun and long diagonal shadows, minimal props). $KEEP" $R/prod1.png $RB &
edit B_desk_high_26 gpt-image-2.6-flare 1536x1024 high "Place this exact bottle standing on a wooden desk in a sunlit office, next to a closed laptop and a notebook, landscape cover photo. $KEEP" $R/prod1.png &
wait
