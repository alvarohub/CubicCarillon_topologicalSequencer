class classTetra {
  //this class does not inherit from classBall. Objects of this class, in fact just contain FOUR objects of class classBall, one
  // for each corner of the small rectangle that form the balls.
  float posxCent, posyCent; //central position of the tetra ball
  float sizeTetraBall;
  boolean faceExitGlobal;
  Note note;

  //Four classBall objects: 
  classBall[] cornerBall=new classBall[4]; 


  // Constructor:
  classTetra(int currentface, float posx, float posy, float speedx, float speedy, float sizeball, color colball, int[] circuitloop) {  //, Note auxnote) {
    posxCent=posx;
    posyCent=posy;
    sizeTetraBall=sizeball;
    note=new Note(0, 0, 0); //auxnote;

    posx=posxCent-sizeTetraBall/2;
    posy=posyCent-sizeTetraBall/2;
    // Instantiation of the classball objects:
    // (orientation rotates, and position changes too with the index of the corner)
    cornerBall[0]=new classBall(currentface, 0, posx, posy, speedx, speedy, sizeball, colball, circuitloop);
    cornerBall[1]=new classBall(currentface, 90, posx+sizeball, posy, speedx, speedy, sizeball, colball, circuitloop);
    cornerBall[2]=new classBall(currentface, 180, posx+sizeball, posy+sizeball, speedx, speedy, sizeball, colball, circuitloop);
    cornerBall[3]=new classBall(currentface, 270, posx, posy+sizeball, speedx, speedy, sizeball, colball, circuitloop);
  }


  // motion:
  void move() {
    faceExitGlobal=true;
    for (int i=0; i<4; i++) {
      cornerBall[i].move(); 
      faceExitGlobal=faceExitGlobal&cornerBall[i].faceExit;
    }
    // update the position of the tetraball center too:
    posxCent=cornerBall[0].x+sizeTetraBall/2;
    posyCent=cornerBall[0].y+sizeTetraBall/2;
    // test of exit of face, for only ONE cornerBall (ideally, it should be the CENTER of the face: a fifth ball...)
    //if (cornerBall[0].faceExit==true) playNote(120,70,15);
  }

  //drawing method (just draw the four balls):
  void display() {
    for (int i=0; i<4; i++) cornerBall[i].display();
  }

  //void playNote(int pitch, int vel, int lenTicks) {
  //  // note = new Note(gamme[myNumber%5]-24+12*(myNumber%4),127,1500);//int(xPos/5f),100,1000);//int(yPos/10f)+60,1000));//int(random(1000)));
  //  myBus.sendNoteOn(channel, pitch, vel);//, lenTicks); // Send a Midi noteOn
  //  delay(200);
  //  myBus.sendNoteOff(channel, pitch, vel); 

  //  //note=new Note(pitch, vel, lenTicks);//(63,120,1500);
  //  //myBus.sendNoteOn(note);
  //}
}
