#include <stdio.h>

int add(int a, int b) {
    return a + b;
}

int multiply(int a, int b) {
    int result = 0;
    for (int i = 0; i < b; i++) {
        result = add(result, a);
    }
    return result;
}

int main(void) {
    int x = add(3, 4);
    int y = multiply(5, 6);
    printf("add: %d, multiply: %d\n", x, y);
    return 0;
}
