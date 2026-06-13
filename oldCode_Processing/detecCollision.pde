void detectCollision() {
  // detects collisions between the TETRA balls, and produce sound
   for(int i = 0;i < tetraball.length;i++){
     for(int j = i+1;j < tetraball.length;j++){
       if (tetraball[i].cornerBall[0].currentFaceIndex==tetraball[j].cornerBall[0].currentFaceIndex) // in fact, I should define a ball for the CENTER (eg, make pentaballs...)
        if (abs(tetraball[i].posxCent-tetraball[j].posxCent)<tetraball[i].sizeTetraBall/5) 
        if (abs(tetraball[i].posyCent-tetraball[j].posyCent)<tetraball[i].sizeTetraBall/5) {
        
     //  playNote(i+j,80,150);
      //  playNote(64+j*2,100,15);
          
        }
       
     }
  }
  
}
