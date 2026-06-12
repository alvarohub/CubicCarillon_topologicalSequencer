 class classBall{
  int currentFaceIndex; // the index of the face where the (upper-left corner of the) ball is at any given moment;
  float currentOrientation; // can be 0, 90, 180 or 270 degrees (or can be coded as 0 to 3)
  float vx, vy;
  float x, y; // the coordinates are with respect to the face referential 
  color col;
  float minOpacity=100;//230; // this will be modulated as a function of the number of corners that are INSIDE a current face, and the value will be stored in variable "opacity"
  float opacity;
  float siz; //size of the ball, and auxiliary sizes when 
  // And a list of how the ball has to wander on the faces and the positions on the faces of the polyhedron:
  int[] circuit; 
  boolean faceExit;

// constructor:
  classBall(int currentface, float currentorient, float posx, float posy, float speedx, float speedy, float sizeball, color colball, int[] circuitloop) {
   currentFaceIndex=currentface;
   currentOrientation=currentorient;
   x=posx; y=posy;
   vx=speedx; vy=speedy;
   siz=sizeball;
   col=colball;
   circuit=circuitloop; // REM: QUESTION: is this assignation enough? is it not necessary to FIRST instantiate the circuit, then COPY it's content?
  faceExit=false;
}

//methods:
  void move(){
    faceExit=false; // this is for producing a sound in the tetraball class.
    
    float aux=polyhedron.faceGeom[currentFaceIndex].sizeSide;
    x += vx; // ((x+vx+aux/2)-int((x+vx-aux/2)/aux)*aux)-aux/2; 
    y += vy;
    //midiOut.sendController(new Controller(myNumber,int(x/6)+2));
    
    // Examine boundaries, and do the necessary transformations to get the ball rolling on the faces of the polyhedron (for the 
    // time being, the faces are assumed to be squared, and parallel to the displaying axis!):
    if(x > (polyhedron.faceGeom[currentFaceIndex].sizeSide/2)) { // this means that the ball exits through the edge 0 (CONVENTION for the time being!)
      // println(currentFaceIndex);
      //print(polyhedron.faceGraph[currentFaceIndex].edge[0]+" ");
      //println(polyhedron.faceGraph[currentFaceIndex].transformPos[0]);
      //delay(200);
      
      //Reposition the ball to enter the new face, by doing the proper rotation/symmetry specified on the Faces array:
      x=x-polyhedron.faceGeom[currentFaceIndex].sizeSide;
      crossingTransforPos(polyhedron.faceGraph[currentFaceIndex].transformPos[0]);
      crossingTransforSpeed(polyhedron.faceGraph[currentFaceIndex].transformSpeed[0]); // rem: processing does not support passing parameters by address or reference!!!???
      // update the current face:
      currentFaceIndex=polyhedron.faceGraph[currentFaceIndex].edge[0]; //advance by looping on the faces circuit
      
      faceExit=true; // this is for producing a sound in the tetraball class.
      
    }
    else if(x < (-polyhedron.faceGeom[currentFaceIndex].sizeSide/2)) { // this means that the ball exits through the edge 2 (CONVENTION for the time being!)
      // reposition the ball on the new face, by doing the proper rotation/symmetry specified on the Faces array:
      x=x+polyhedron.faceGeom[currentFaceIndex].sizeSide;
      crossingTransforPos(polyhedron.faceGraph[currentFaceIndex].transformPos[2]);
      crossingTransforSpeed(polyhedron.faceGraph[currentFaceIndex].transformSpeed[2]);
         currentFaceIndex=polyhedron.faceGraph[currentFaceIndex].edge[2]; //advance by looping on the faces circuit
         faceExit=true; // this is for producing a sound in the tetraball class.
    }
    else if(y > (polyhedron.faceGeom[currentFaceIndex].sizeSide/2)) { // this means that the ball exits through the edge 1 (CONVENTION for the time being!)
      // reposition the ball on the new face, by doing the proper rotation/symmetry specified on the Faces array:
      y=y-polyhedron.faceGeom[currentFaceIndex].sizeSide;
      crossingTransforPos(polyhedron.faceGraph[currentFaceIndex].transformPos[1]);
      crossingTransforSpeed(polyhedron.faceGraph[currentFaceIndex].transformSpeed[1]);
      currentFaceIndex=polyhedron.faceGraph[currentFaceIndex].edge[1]; //advance by looping on the faces circuit
      faceExit=true; // this is for producing a sound in the tetraball class.
    }
    else if(y < (-polyhedron.faceGeom[currentFaceIndex].sizeSide/2)) { // this means that the ball exits through the edge 3 (CONVENTION for the time being!)
      y=y+polyhedron.faceGeom[currentFaceIndex].sizeSide;
      // reposition the ball on the new face, by doing the proper rotation/symmetry specified on the Faces array:
       crossingTransforPos(polyhedron.faceGraph[currentFaceIndex].transformPos[3]);
      crossingTransforSpeed(polyhedron.faceGraph[currentFaceIndex].transformSpeed[3]);
     currentFaceIndex=polyhedron.faceGraph[currentFaceIndex].edge[3]; //advance by looping on the faces circuit
     faceExit=true; // this is for producing a sound in the tetraball class.
    }
    
  }


   void crossingTransforPos(int transform) {
  float auxY;
     switch(transform) {
     case 0: // means identity transform: do nothing
     break;
     
     case -1: // means -90 degrees (CWW) rotation (rem: (0,0) corresponds to the center of the face!)
      auxY=y;
       y=-x; x=auxY;
     break;
     
       case 1: // means 90 degrees (CW) rotation (rem: (0,0) corresponds to the center of the face!)
       auxY=y;
       y=x; x=-auxY;
     break;
     
     case 2: //symmetry with respect to the center of the face (i.e., rotation by 180 degrees):
       x=-x;
       y=-y;
     break;
     
     /*
     case -2: //symmetry on second bisectrix
       auxY=y;
       y=-x; x=-auxY;
     break;
     
     case 3: //flip vertical:
     y=-y;
     break;
     
      case 4: //horizontal flip:
     x=-x;
     break;
     */
     
     default:
     break;
    } 
   }

 void crossingTransforSpeed(int transform) {
   // transformation of the speed vector and also the orientation of the ball
      float auxVY;
   switch(transform) {
     case 0: // means identity transform: do nothing
     break;
     
     case -1: // means -90 degrees (CWW rotation). Rem: (0,0) corresponds to the center of the face, the y points towards the bottom of the screen...
       auxVY=vy;
       vy=-vx; vx=auxVY;
       currentOrientation=(currentOrientation-90)%360;
     break;
     
       case 1: // means 90 degrees (CW rotation) with respect to the center of the face (attn: y axis points to bottom of screen)
       auxVY=vy;
       vy=vx; vx=-auxVY;
       currentOrientation=(currentOrientation+90)%360;
     break;
     
     case 2: //180 degree rotation (i.e., symmetry with respect to the center of the ball)
     vy=-vy;
     vx=-vx;
      currentOrientation=(currentOrientation+180)%360;
     break;
     
     default:
     break;
    } 
   }

 

// display ball: (for the time being, there is no handling of protruding parts)
  void display(){
    opacity=1.0*minOpacity;///4; // we start with the minimum possible opacity, assuming all corners are inside the current face 
    //(because the four square-balls will be superimposed then) 
    float auxFaceSize=1.0*polyhedron.faceGeom[currentFaceIndex].sizeSide;
    if (!faceExit) fill(col,opacity); else fill(255);
    color(col);
    //strokeWeight(2);
    noStroke();
    rectMode(CORNER);
    pushMatrix();
    translate(x+polyhedron.faceGeom[currentFaceIndex].x+auxFaceSize/2,y+polyhedron.faceGeom[currentFaceIndex].y+auxFaceSize/2);
    rotateZ(1.0*currentOrientation/180*PI);
    // REM: the rectangle must be drawn starting FROM THE CORNER. 
    // We will make the necessary testing to avoid having protruding parts:
    //rect(x+polyhedron.faceGeom[currentFaceIndex].x,y+polyhedron.faceGeom[currentFaceIndex].y,siz,siz);
    rect(0,0,siz,siz);
    //ellipse(x,y,20,20);
    popMatrix();
  }
}
