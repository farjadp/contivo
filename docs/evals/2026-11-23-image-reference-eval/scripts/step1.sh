source "$(dirname "$0")/lib.sh"
M=gpt-image-2.5-flare
S1='Linocut print, hand-carved look, only two inks: burnt orange and dark teal on cream paper, heavy paper grain, bold carved outlines, visible gouge marks. No text, letters or logos.'
S2='Soft high-key studio photograph, pastel mint and peach colour backdrop, hard morning sun casting long crisp diagonal shadows, slightly overhead angle, minimal props. No text, letters or logos.'
gen refA1 $M 1024x1024 "A bicycle leaning against a wall. $S1" &
gen refA2 $M 1024x1024 "A steaming coffee cup on a table. $S1" &
gen refA3 $M 1024x1024 "A potted monstera plant by a window. $S1" &
gen refA4 $M 1024x1024 "A narrow city street with houses. $S1" &
gen refB1 $M 1024x1024 "A pair of sneakers. $S2" &
gen refB2 $M 1024x1024 "A ceramic vase with one tulip. $S2" &
gen refB3 $M 1024x1024 "A stack of folded towels. $S2" &
gen prod1 $M 1024x1024 "Product photo: a matte black insulated steel water bottle with a brushed steel screw cap, the white wordmark NORDA printed vertically on the body, and exactly three thin orange rings around the base. Standing upright, centered, plain light-grey seamless studio background, soft even light." &
wait
