class classPoly{
  // The polyhedron, as a bunch of faces and a graph connecting the faces:
  // number of faces:
  int numFaces; // the total number of faces of the polyedron (can be retrieved too by doing faceGeom.size or faceGraph.size
  classFaceGeom[] faceGeom; // face geometry and displaying attributes (in this example, faces are SQUARES, even if topologically the face
  // connects with more or less than 4 other faces...)
  classFaceGraph[] faceGraph; // polyhedron topology (we assume a maximum of 100 edges/face, to avoid dynamic memory allocation).
  
  // Constructor:
  classPoly(int totalfaces, classFaceGeom[] facegeom, classFaceGraph[] facegraph) {
    numFaces=totalfaces;
    faceGeom=facegeom; // ATTN!!! if doing only this pointer equation, then memory allocation must be done BEFORE object instantiation
    faceGraph=facegraph;
  }
  
}
