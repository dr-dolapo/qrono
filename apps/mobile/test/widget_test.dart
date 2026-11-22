import 'package:flutter_test/flutter_test.dart';
import 'package:qrono_mobile/main.dart';

void main() {
  testWidgets('home screen shows the empty events state', (tester) async {
    await tester.pumpWidget(const QronoApp());

    expect(find.text('Qrono'), findsOneWidget);
    expect(find.text('My events'), findsOneWidget);
    expect(find.text('No events yet'), findsOneWidget);
  });
}
