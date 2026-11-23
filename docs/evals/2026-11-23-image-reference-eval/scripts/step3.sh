source "$(dirname "$0")/lib.sh"
M=gpt-image-2.5-flare; R=raw; RB="$R/refB1.png $R/refB2.png $R/refB3.png"
KEEP='Keep the bottle exactly as it is in the photo: same shape and proportions, same brushed steel cap, the NORDA wordmark unchanged, exactly three thin orange rings at the base. Do not redraw or restyle the bottle. Add no other text, letters or logos.'
edit B_desk    $M 1536x1024 - "Place this exact bottle standing on a wooden desk in a sunlit office, next to a closed laptop and a notebook, landscape cover photo. $KEEP" $R/prod1.png &
edit B_desk_26 gpt-image-2.6-flare 1536x1024 - "Place this exact bottle standing on a wooden desk in a sunlit office, next to a closed laptop and a notebook, landscape cover photo. $KEEP" $R/prod1.png &
edit B_bg      $M 1024x1536 - "Replace only the background with a soft warm peach-to-cream gradient and a soft contact shadow. Portrait framing with more space above the bottle. $KEEP" $R/prod1.png &
edit B_brand   $M 1024x1024 - "Photograph the bottle from the first image in the visual style of the other images (backdrop colours, hard sun and long diagonal shadows, minimal props). $KEEP" $R/prod1.png $RB &
wait
